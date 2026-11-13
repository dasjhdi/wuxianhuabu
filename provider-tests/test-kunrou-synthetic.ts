// 用一张程序生成的纯色渐变图（无人物、无敏感内容）测试参考图通道是否被整体拦截
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT_DIR = "D:/wuxianhuabu/test-assets";
mkdirSync(OUT_DIR, { recursive: true });

// --- 极简 PNG 编码（RGB, 8bit, 无滤波） ---
const table = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c;
}
const crc32 = (buf: Buffer) => {
  let c = -1;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const W = 640, H = 360;
const raw = Buffer.alloc((W * 3 + 1) * H);
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  for (let x = 0; x < W; x++) {
    raw[p++] = Math.round((x / W) * 200 + 30);
    raw[p++] = Math.round((y / H) * 180 + 40);
    raw[p++] = 120;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
const path = `${OUT_DIR}/gradient.png`;
writeFileSync(path, png);
console.log("合成图已生成:", path, (png.length / 1024).toFixed(0) + "KB");

const settings = JSON.parse(readFileSync("D:/wuxianhuabu/Toonflow-app/data/settings.json", "utf8"));
const apiKey = settings?.settings?.mediaProviderConfigs?.kunrou?.apiKey;
const task = JSON.parse(readFileSync(
  "D:/wuxianhuabu/Toonflow-app/data/mediaTasks/workspacedf21467c46fa559f61cb5e4973c7d1f003b808079bb4b26517560624ba134230/task453d91672b6c4a1e94b611450b66767e.json",
  "utf8",
));

const BASE = "https://api.kunrouai.com/v1";
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

const body = {
  model: "gemini-omni-1.1-flash",
  prompt: task.request.prompt,
  duration: 4,
  resolution: "720p",
  aspect_ratio: "16:9",
  reference_images: [dataUrl],
};

console.log(new Date().toISOString().slice(11, 19), "提交：提示词 + 1 张无人物合成图");
const created = await fetch(`${BASE}/videos`, { method: "POST", headers, body: JSON.stringify(body) });
const createdText = await created.text();
console.log("提交状态:", created.status, createdText.slice(0, 240));

let taskId = "";
try { taskId = JSON.parse(createdText)?.id ?? ""; } catch {}
if (!created.ok || !taskId) process.exit(0);

const deadline = Date.now() + 6 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const res = await fetch(`${BASE}/videos/${encodeURIComponent(taskId)}`, { headers });
  let parsed: any = {};
  try { parsed = JSON.parse(await res.text()); } catch {}
  console.log(new Date().toISOString().slice(11, 19), "轮询:", parsed?.status ?? res.status, parsed?.progress ?? "-");
  if (parsed?.status === "completed") { console.log("\n结果：成功", parsed?.url ?? ""); process.exit(0); }
  if (parsed?.status === "failed") { console.log("\n结果：失败，平台原文:", JSON.stringify(parsed?.error ?? parsed).slice(0, 600)); process.exit(0); }
}
console.log("超时:", taskId);
