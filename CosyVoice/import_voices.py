"""批量注册角色音色

约定目录结构（同名的 .wav 与 .txt 成对出现）：

    D:\wuxianhuabu\voice-src\
        lingqingyan.wav
        lingqingyan.txt      # 与音频逐字一致的文本
        suwan.wav
        suwan.txt

用法：
    .venv/Scripts/python.exe import_voices.py D:\wuxianhuabu\voice-src

每个音色也可另放 <id>.json：{"name":"凌清砚","description":"低沉清冷"}
"""

from __future__ import annotations

import json
import mimetypes
import sys
import urllib.request
import uuid
from pathlib import Path

SERVICE = "http://127.0.0.1:8100"
AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


def post_multipart(url: str, fields: dict[str, str], file_field: str, file_path: Path) -> dict:
    boundary = uuid.uuid4().hex
    body = bytearray()
    for key, value in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode()
    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{file_path.name}\"\r\n".encode()
    body += f"Content-Type: {mime}\r\n\r\n".encode()
    body += file_path.read_bytes() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    request = urllib.request.Request(url, data=bytes(body), method="POST")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode())


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    folder = Path(sys.argv[1])
    if not folder.is_dir():
        print(f"目录不存在：{folder}")
        return 1

    audio_files = [p for p in sorted(folder.iterdir()) if p.suffix.lower() in AUDIO_SUFFIXES]
    if not audio_files:
        print("没有找到音频文件")
        return 1

    ok = 0
    for audio in audio_files:
        voice_id = audio.stem
        text_file = audio.with_suffix(".txt")
        if not text_file.is_file():
            print(f"[跳过] {voice_id}: 缺少 {text_file.name}（逐字转写）")
            continue
        prompt = text_file.read_text(encoding="utf-8").strip()
        if not prompt:
            print(f"[跳过] {voice_id}: {text_file.name} 为空")
            continue
        meta_file = audio.with_suffix(".json")
        meta = {}
        if meta_file.is_file():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                meta = {}
        try:
            result = post_multipart(
                f"{SERVICE}/voices",
                {
                    "voiceId": voice_id,
                    "promptText": prompt,
                    "name": str(meta.get("name") or voice_id),
                    "description": str(meta.get("description") or ""),
                },
                "file",
                audio,
            )
            print(f"[成功] {voice_id}: {result.get('seconds')} 秒")
            ok += 1
        except Exception as error:  # noqa: BLE001 - 单条失败不影响其余音色
            print(f"[失败] {voice_id}: {error}")

    print(f"\n完成：{ok}/{len(audio_files)} 个音色已注册")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
