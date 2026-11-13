import { Router } from "express";
import { Readable } from "node:stream";

/**
 * 本地音色库代理：把画布的请求转发给本机 CosyVoice 服务（127.0.0.1:8100）。
 * 这样通过隧道/局域网访问画布的人也能管理音色，而无需直连 8100。
 */
const BASE = "http://127.0.0.1:8100";
const router = Router();

async function forward(res: import("express").Response, path: string, init: RequestInit) {
  try {
    const upstream = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(10 * 60_000) });
    res.status(upstream.status);
    const type = upstream.headers.get("content-type");
    if (type) res.setHeader("Content-Type", type);
    const cache = upstream.headers.get("cache-control");
    if (cache) res.setHeader("Cache-Control", cache);
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
  } catch (error) {
    res.status(502).json({ code: 502, data: null, message: `本地音色服务不可达：${(error as Error).message}` });
  }
}

router.get("/", (_req, res) => forward(res, "/voices", {}));

router.post("/", async (req, res) => {
  // ACT: 透传原始 multipart，避免在应用层重新解析文件。
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  await forward(res, "/voices", {
    method: "POST",
    headers: { "content-type": String(req.headers["content-type"] ?? "") },
    body,
  });
});

router.delete("/:id", (req, res) => forward(res, `/voices/${encodeURIComponent(req.params.id)}`, { method: "DELETE" }));

router.post("/:id/sample", (req, res) =>
  forward(res, `/voices/${encodeURIComponent(req.params.id)}/sample`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body ?? {}),
  }),
);

router.get("/:id/sample", (req, res) => forward(res, `/voices/${encodeURIComponent(req.params.id)}/sample?t=${Date.now()}`, {}));

router.get("/:id/ref", (req, res) => forward(res, `/voices/${encodeURIComponent(req.params.id)}/ref.wav`, {}));

export default router;
