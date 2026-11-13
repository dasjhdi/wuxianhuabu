"""检查音色素材是否合规（导入前自检）

用法：
    .venv/Scripts/python.exe check_voices.py D:\wuxianhuabu\voice-src

逐条检查：时长是否在 3–30 秒、是否有同名 .txt、文本是否为空、采样率与声道。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

FFPROBE = Path(r"D:/wuxianhuabu/Toonflow-app/data/ffmpeg/win32-x64/ffprobe.exe")
AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


def probe(path: Path) -> dict:
    result = subprocess.run(
        [str(FFPROBE), "-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=sample_rate,channels", "-of", "json", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="ignore",
    )
    try:
        data = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return {}
    stream = (data.get("streams") or [{}])[0]
    return {
        "duration": float((data.get("format") or {}).get("duration") or 0),
        "sample_rate": stream.get("sample_rate"),
        "channels": stream.get("channels"),
    }


def main() -> int:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"D:/wuxianhuabu/voice-src")
    if not folder.is_dir():
        print(f"目录不存在：{folder}")
        return 1
    audios = [p for p in sorted(folder.iterdir()) if p.suffix.lower() in AUDIO_SUFFIXES]
    if not audios:
        print(f"{folder} 下还没有音频文件")
        return 0

    problems = 0
    print(f"{'音色ID':<18}{'时长':>7}  {'采样率':>7} {'声道':>4}  {'文本':<6} 结论")
    for audio in audios:
        info = probe(audio)
        text_file = audio.with_suffix(".txt")
        text_ok = text_file.is_file() and text_file.read_text(encoding="utf-8").strip() != ""
        duration = info.get("duration", 0)
        verdict = []
        if duration < 3 or duration > 30:
            verdict.append("时长需 3–30 秒")
        if not text_ok:
            verdict.append("缺少同名 .txt 或内容为空")
        if info.get("channels") not in (1, "1"):
            verdict.append("建议单声道")
        if str(info.get("sample_rate")) not in ("16000", "16000.0", "22050", "24000", "44100", "48000"):
            verdict.append("采样率异常")
        if verdict:
            problems += 1
        print(f"{audio.stem:<18}{duration:>7.1f}  {str(info.get('sample_rate')):>7} {str(info.get('channels')):>4}  {'有' if text_ok else '缺':<6} {'通过' if not verdict else '；'.join(verdict)}")

    print(f"\n共 {len(audios)} 个音频，{len(audios) - problems} 个可直接导入")
    return 0 if not problems else 2


if __name__ == "__main__":
    raise SystemExit(main())
