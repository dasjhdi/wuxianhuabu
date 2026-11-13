"""本地 CosyVoice2 语音克隆服务

职责：
- 加载 CosyVoice2-0.5B（GPU），对外提供 HTTP 接口
- 音色库按目录管理：voices/<voiceId>/{ref.wav, prompt.txt, meta.json}
- POST /tts       文本 → 克隆音色音频（wav）
- GET  /voices    列出音色
- POST /voices    新增音色（上传参考音频 + 逐字转写）

启动：
    .venv/Scripts/python.exe server.py
默认监听 127.0.0.1:8100。
"""

from __future__ import annotations

import gc
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path

import numpy as np
import torch
import torchaudio
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

ROOT = Path(__file__).resolve().parent
# ACT: 仓库未把 Matcha-TTS 装进环境，这里显式加入检索路径。
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "third_party" / "Matcha-TTS"))

MODEL_DIR = os.environ.get("COSYVOICE_MODEL_DIR", r"D:/wuxianhuabu/models/CosyVoice2-0.5B")
VOICE_DIR = Path(os.environ.get("COSYVOICE_VOICE_DIR", str(ROOT / "voices")))
PORT = int(os.environ.get("COSYVOICE_PORT", "8100"))
MAX_REF_SECONDS = 30

# ACT: 客户端自带 ffmpeg，加入 PATH 以便 mp3/m4a 等格式能被解码。
FFMPEG_DIR = Path(r"D:/wuxianhuabu/Toonflow-app/data/ffmpeg/win32-x64")
if FFMPEG_DIR.is_dir():
    os.environ["PATH"] = f"{FFMPEG_DIR}{os.pathsep}{os.environ.get('PATH', '')}"


def normalize_reference(src: Path, dst: Path) -> float:
    """把任意格式参考音频统一为 16 kHz 单声道 PCM16，返回时长（秒）。"""
    try:
        waveform, sample_rate = torchaudio.load(str(src))
        if waveform.dim() == 2 and waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        if sample_rate != 16000:
            waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
        torchaudio.save(str(dst), waveform, 16000, format="wav", encoding="PCM_S", bits_per_sample=16)
        return waveform.shape[1] / 16000
    except Exception:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise
        subprocess.run(
            [ffmpeg, "-y", "-i", str(src), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)],
            check=True, capture_output=True,
        )
        info = torchaudio.info(str(dst))
        return info.num_frames / info.sample_rate


PROVIDER_FILE = Path(os.environ.get("COSYVOICE_PROVIDER_FILE", r"D:/wuxianhuabu/Toonflow-app/data/providers/localVoice.ts"))

PROVIDER_TEMPLATE = '''type MediaAsset = { mediaType: "audio"; type: "base64"; data: string; mimeType: string };

type AudioRequest = { model: string; text?: string; prompt?: string; speed?: number; other?: Record<string, unknown> };
type Context = { config: Record<string, unknown>; signal?: AbortSignal; tool: { fetch: typeof fetch; errorMessage(value: unknown): string } };

const SERVICE = "http://127.0.0.1:8100";
const TIMEOUT = 10 * 60_000;

// 本文件由本地音色服务自动生成：每次上传/删除音色后重写，模型列表即当前音色库。
export default {
  id: "localVoice",
  label: "本地音色克隆",
  version: "1.2.0",
  readme: `音色由本机 CosyVoice2 克隆生成，模型列表即当前音色库。

- 在 http://127.0.0.1:8100 上传参考音频（10–30 秒、单人、无背景音）并填写逐字文本
- 上传后本列表自动更新，选对应角色即可，无需手填 ID
- 参考音频越干净，克隆相似度越高`,
  rules: [],
  models: __MODELS__,
  async generateAudio(this: Context, request: AudioRequest): Promise<MediaAsset[]> {
    this.signal?.throwIfAborted();
    const text = String(request.text ?? request.prompt ?? "").trim();
    if (!text) throw new Error("请填写待朗读文本");
    const voiceId = String((request.other ?? {}).voiceId ?? "").trim() || request.model;
    if (!voiceId || voiceId === "cosyvoice2") throw new Error("请先在 http://127.0.0.1:8100 上传音色");

    const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT), ...(this.signal ? [this.signal] : [])]);
    let response: Response;
    try {
      response = await this.tool.fetch(`${SERVICE}/tts/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId, speed: request.speed ?? 1 }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new Error("任务已取消或等待超时");
      throw new Error(`本地语音服务不可达：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail.trim() ? this.tool.errorMessage(detail.trim().slice(0, 200)) : `本地语音服务返回 HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { data?: unknown; mimeType?: unknown };
    if (typeof payload?.data !== "string" || !payload.data) throw new Error("本地语音服务未返回音频");
    return [{ mediaType: "audio", type: "base64", data: payload.data, mimeType: typeof payload.mimeType === "string" ? payload.mimeType : "audio/wav" }];
  },
};
'''


def sync_provider() -> None:
    """把当前音色库写成画布供应商的模型列表，让角色直接出现在模型下拉里。"""
    models = []
    if VOICE_DIR.exists():
        for folder in sorted(VOICE_DIR.iterdir()):
            ref = folder / "ref.wav"
            if not ref.is_file():
                continue
            name = folder.name
            meta_file = folder / "meta.json"
            if meta_file.is_file():
                try:
                    name = json.loads(meta_file.read_text(encoding="utf-8")).get("name") or folder.name
                except json.JSONDecodeError:
                    name = folder.name
            models.append({"id": folder.name, "label": name, "type": "audio", "mode": ["text"]})
    if not models:
        models = [{"id": "cosyvoice2", "label": "CosyVoice2 克隆（请先上传音色）", "type": "audio", "mode": ["text"]}]
    try:
        PROVIDER_FILE.parent.mkdir(parents=True, exist_ok=True)
        PROVIDER_FILE.write_text(PROVIDER_TEMPLATE.replace("__MODELS__", json.dumps(models, ensure_ascii=False, indent=4)), encoding="utf-8")
        print(f"[cosyvoice] 已同步 {len(models)} 个音色到画布供应商", flush=True)
    except Exception as error:  # noqa: BLE001 - 同步失败不应影响音频服务
        print(f"[cosyvoice] 同步供应商失败：{error}", flush=True)


app = FastAPI(title="CosyVoice2 本地语音服务")
_model = None

PAGE = (ROOT / "page.html").read_text(encoding="utf-8")



_last_used = time.time()
_model_lock = threading.Lock()
# ACT: 空闲超过该秒数自动卸载模型释放显存（默认 10 分钟），COSYVOICE_IDLE_UNLOAD=0 可关闭。
IDLE_UNLOAD_SECONDS = int(os.environ.get("COSYVOICE_IDLE_UNLOAD", "600") or 0)


def model():
    global _model, _last_used
    _last_used = time.time()
    if _model is None:
        with _model_lock:
            if _model is None:
                from cosyvoice.cli.cosyvoice import CosyVoice2
                started = time.time()
                use_fp16 = os.environ.get("COSYVOICE_FP16", "1") != "0"
                # ACT: 仓库缺少 flow.encoder.fp16.zip，JIT 默认关闭，需要时用 COSYVOICE_JIT=1 显式开启。
                use_jit = os.environ.get("COSYVOICE_JIT", "0") == "1"
                try:
                    _model = CosyVoice2(MODEL_DIR, load_jit=use_jit, load_trt=False, fp16=use_fp16)
                    print(f"[cosyvoice] 模型加载完成（fp16={use_fp16} jit={use_jit}），用时 {time.time() - started:.1f}s", flush=True)
                except Exception as error:
                    # ACT: fp16/JIT 在部分环境不可用，回退到 fp32 保证可用性优先。
                    print(f"[cosyvoice] fp16/jit 加载失败，回退 fp32：{error}", flush=True)
                    _model = CosyVoice2(MODEL_DIR, load_jit=False, load_trt=False, fp16=False)
                    print(f"[cosyvoice] 模型加载完成（fp32），用时 {time.time() - started:.1f}s", flush=True)
    return _model


def idle_unloader() -> None:
    global _model
    while True:
        time.sleep(60)
        if IDLE_UNLOAD_SECONDS <= 0 or _model is None or time.time() - _last_used < IDLE_UNLOAD_SECONDS:
            continue
        with _model_lock:
            if _model is None or time.time() - _last_used < IDLE_UNLOAD_SECONDS:
                continue
            _model = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            print(f"[cosyvoice] 闲置超过 {IDLE_UNLOAD_SECONDS}s，已卸载模型释放显存", flush=True)


def voice_paths(voice_id: str) -> tuple[Path, Path]:
    if not re.fullmatch(r"[A-Za-z0-9_\-\u4e00-\u9fa5]{1,64}", voice_id):
        raise HTTPException(400, "音色 ID 只能包含中英文、数字、下划线与短横线")
    folder = VOICE_DIR / voice_id
    return folder / "ref.wav", folder / "prompt.txt"


def read_voice(voice_id: str) -> tuple[Path, str]:
    ref, prompt_file = voice_paths(voice_id)
    if not ref.is_file() or not prompt_file.is_file():
        raise HTTPException(404, f"音色不存在：{voice_id}")
    prompt = prompt_file.read_text(encoding="utf-8").strip()
    if not prompt:
        raise HTTPException(400, f"音色 {voice_id} 缺少参考文本")
    return ref, prompt


def wav_bytes(speech: torch.Tensor, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    tensor = speech.detach().cpu()
    if tensor.dim() == 1:
        tensor = tensor.unsqueeze(0)
    # ACT: 统一输出 16-bit PCM，避免 float32 WAV 在部分播放器/编辑器里无法识别。
    torchaudio.save(buffer, tensor, sample_rate, format="wav", encoding="PCM_S", bits_per_sample=16)
    return buffer.getvalue()


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_DIR, "loaded": _model is not None,
            "idleSeconds": IDLE_UNLOAD_SECONDS, "lastUsedAgo": round(time.time() - _last_used),
            "voices": len(list(VOICE_DIR.glob("*/ref.wav"))) if VOICE_DIR.exists() else 0}


@app.get("/voices")
def list_voices():
    items = []
    if VOICE_DIR.exists():
        for folder in sorted(VOICE_DIR.iterdir()):
            ref = folder / "ref.wav"
            if not ref.is_file():
                continue
            meta = {}
            meta_file = folder / "meta.json"
            if meta_file.is_file():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    meta = {}
            items.append({
                "voiceId": folder.name,
                "name": meta.get("name") or folder.name,
                "description": meta.get("description", ""),
                "seconds": meta.get("seconds"),
            })
    return {"voices": items}


@app.get("/voices/{voice_id}/ref.wav")
def voice_preview(voice_id: str):
    ref, _ = voice_paths(voice_id)
    if not ref.is_file():
        raise HTTPException(404, "音色不存在")
    return FileResponse(ref, media_type="audio/wav")


def sample_paths(voice_id: str) -> tuple[Path, Path]:
    ref, _ = voice_paths(voice_id)
    folder = ref.parent
    return folder / "sample.wav", folder / "sample.json"


@app.get("/voices/{voice_id}/sample")
def get_sample(voice_id: str):
    audio, _ = sample_paths(voice_id)
    if not audio.is_file():
        raise HTTPException(404, "样音尚未生成")
    return FileResponse(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.post("/voices/{voice_id}/sample")
async def make_sample(voice_id: str, payload: dict):
    """用固定测试句生成样音并缓存；文本变化才重新合成。"""
    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text 不能为空")
    ref, prompt_text = read_voice(voice_id)
    audio, meta_file = sample_paths(voice_id)
    digest = f"{len(text)}:{abs(hash(text))}"
    if audio.is_file() and meta_file.is_file():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            if meta.get("digest") == digest and meta.get("text") == text:
                return {"voiceId": voice_id, "cached": True, "seconds": meta.get("seconds")}
        except json.JSONDecodeError:
            pass

    engine = model()
    started = time.time()
    chunks = []
    with torch.inference_mode():
        for item in engine.inference_zero_shot(text, prompt_text, str(ref), stream=False, speed=1.0):
            chunks.append(item["tts_speech"])
    if not chunks:
        raise HTTPException(500, "模型未返回音频")
    speech = torch.cat(chunks, dim=1)
    audio.write_bytes(wav_bytes(speech, engine.sample_rate))
    seconds = round(speech.shape[1] / engine.sample_rate, 2)
    meta_file.write_text(json.dumps({"text": text, "digest": digest, "seconds": seconds}, ensure_ascii=False), encoding="utf-8")
    print(f"[cosyvoice] 样音 {voice_id} {seconds}s {time.time() - started:.1f}s", flush=True)
    return {"voiceId": voice_id, "cached": False, "seconds": seconds}


@app.delete("/voices/{voice_id}")
def delete_voice(voice_id: str):
    ref, prompt_file = voice_paths(voice_id)
    if not ref.is_file() and not prompt_file.is_file():
        raise HTTPException(404, "音色不存在")
    import shutil
    shutil.rmtree(ref.parent)
    sync_provider()
    return {"deleted": voice_id}


@app.get("/", response_class=HTMLResponse)
def index():
    # ACT: 页面迭代频繁，禁用缓存避免浏览器加载旧脚本。
    return HTMLResponse(PAGE, headers={"Cache-Control": "no-store"})


@app.post("/voices")
async def add_voice(voiceId: str = Form(...), promptText: str = Form(...), name: str = Form(""), description: str = Form(""), file: UploadFile = File(...)):
    ref, prompt_file = voice_paths(voiceId)
    data = await file.read()
    if not data:
        raise HTTPException(400, "参考音频为空")
    ref.parent.mkdir(parents=True, exist_ok=True)
    tmp = ref.with_name("upload.bin")
    tmp.write_bytes(data)
    try:
        seconds = normalize_reference(tmp, ref)
    except Exception as error:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, f"参考音频无法解析：{error}")
    finally:
        tmp.unlink(missing_ok=True)
    if seconds < 3 or seconds > MAX_REF_SECONDS:
        raise HTTPException(400, f"参考音频需为 3–{MAX_REF_SECONDS} 秒，当前 {seconds:.1f} 秒")
    prompt_file.write_text(promptText.strip(), encoding="utf-8")
    (ref.parent / "meta.json").write_text(
        json.dumps({"name": name or voiceId, "description": description, "seconds": round(seconds, 2)}, ensure_ascii=False),
        encoding="utf-8",
    )
    sync_provider()
    return {"voiceId": voiceId, "seconds": round(seconds, 2)}


@app.post("/tts")
async def tts(payload: dict):
    text = str(payload.get("text") or payload.get("prompt") or "").strip()
    voice_id = str(payload.get("voiceId") or "").strip()
    if not text:
        raise HTTPException(400, "text 不能为空")
    if not voice_id:
        raise HTTPException(400, "voiceId 不能为空")
    ref, prompt_text = read_voice(voice_id)
    try:
        speed = float(payload.get("speed") or 1.0)
    except (TypeError, ValueError):
        speed = 1.0
    speed = min(max(speed, 0.5), 2.0)

    engine = model()
    started = time.time()
    chunks = []
    with torch.inference_mode():
        for item in engine.inference_zero_shot(text, prompt_text, str(ref), stream=False, speed=speed):
            chunks.append(item["tts_speech"])
    if not chunks:
        raise HTTPException(500, "模型未返回音频")
    speech = torch.cat(chunks, dim=1)
    audio = wav_bytes(speech, engine.sample_rate)
    print(f"[cosyvoice] {voice_id} {len(text)}字 -> {len(audio)//1024}KB, {time.time()-started:.1f}s", flush=True)
    # ACT: HTTP 头只能是 latin-1，中文音色 ID 不能放进头里，仅保留时长。
    return Response(content=audio, media_type="audio/wav", headers={"X-Duration": f"{speech.shape[1]/engine.sample_rate:.2f}"})


@app.post("/tts/json")
async def tts_json(payload: dict):
    """返回 base64，便于供应商直接使用。"""
    import base64
    text = str(payload.get("text") or payload.get("prompt") or "").strip()
    voice_id = str(payload.get("voiceId") or "").strip()
    if not text or not voice_id:
        raise HTTPException(400, "text 与 voiceId 均不能为空")
    ref, prompt_text = read_voice(voice_id)
    engine = model()
    chunks = []
    with torch.inference_mode():
        for item in engine.inference_zero_shot(text, prompt_text, str(ref), stream=False, speed=float(payload.get("speed") or 1.0)):
            chunks.append(item["tts_speech"])
    speech = torch.cat(chunks, dim=1)
    return JSONResponse({"data": base64.b64encode(wav_bytes(speech, engine.sample_rate)).decode(), "mimeType": "audio/wav", "duration": round(speech.shape[1] / engine.sample_rate, 2)})


if __name__ == "__main__":
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    sync_provider()
    threading.Thread(target=idle_unloader, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
