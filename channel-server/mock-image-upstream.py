"""本地 mock 图片上游 · 仅用于验证渠道图片代理链路

启动：python mock-image-upstream.py [端口，默认 9099]
配合渠道：
  CHANNEL_IMAGE_UPSTREAM_BASE=http://127.0.0.1:9099 python -m uvicorn main:app --host 127.0.0.1 --port 8787

支持的路径：
  POST /v1/images/generations   文生图
  POST /v1/images/edits         参考图编辑（multipart）
  GET  /image/<名称>.png        返回 1x1 PNG，供客户端下载落盘
"""

from __future__ import annotations

import base64
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 1x1 透明 PNG，避免依赖图像库
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9099


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # noqa: A002 - 保持与基类签名一致
        print(f"[mock] {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}", flush=True)

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.startswith("/image/"):
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(PNG_BYTES)))
            self.end_headers()
            self.wfile.write(PNG_BYTES)
            return
        if self.path.endswith("/models"):
            self.send_json({"object": "list", "data": [{"id": "mock-image", "object": "model"}]})
            return
        self.send_json({"error": {"message": "not found"}}, 404)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if not self.path.endswith(("/images/generations", "/images/edits")):
            self.send_json({"error": {"message": "not found"}}, 404)
            return
        model = "unknown"
        prompt = ""
        count = 1
        size = ""
        refs = 0
        content_type = self.headers.get("Content-Type") or ""
        if content_type.startswith("application/json"):
            try:
                payload = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                self.send_json({"error": {"message": "invalid json"}}, 400)
                return
            model = str(payload.get("model") or "unknown")
            prompt = str(payload.get("prompt") or "")
            count = max(1, min(int(payload.get("n") or 1), 4))
            size = str(payload.get("size") or "")
            refs = len(payload.get("images") or [])
        else:
            # multipart：只取 model 字段，足够验证转发
            text = raw.decode("utf-8", "ignore")
            for part in text.split('name="'):
                name, _, rest = part.partition('"')
                if name == "model":
                    model = rest.split("\r\n\r\n", 1)[-1].split("\r\n", 1)[0]
        print(f"[mock] 收到请求 model={model} n={count} size={size} 参考图={refs} prompt={prompt[:40]!r}", flush=True)
        self.send_json({
            "created": int(time.time()),
            "model": model,
            "data": [{"url": f"http://127.0.0.1:{PORT}/image/{index + 1}.png", "revised_prompt": prompt} for index in range(count)],
        })


if __name__ == "__main__":
    print(f"[mock] 图片上游监听 http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
