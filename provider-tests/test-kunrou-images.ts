// 逐张定位：按命令行传入的图片序号发送参考图，观察哪一张或几张触发拦截
import { readFileSync } from "node:fs";

const indices = (process.argv[2] ?? "0").split(",").map(v => Number(v.trim())).filter(v => !Number.isNaN(v));
const settings = JSON.parse(readFileSync("D:/wuxianhuabu/Toonflow-app/data/settings.json", "utf8"));
const apiKey = settings?.settings?.mediaProviderConfigs?.kunrou?.apiKey;
if (!apiKey) throw new Error("未找到 kunrou 的 API Key");

const task = JSON.parse(readFileSync(
  "D:/wuxianhuabu/Toonflow-app/data/mediaTasks/workspacedf21467c46fa559f61cb5e4973c7d1f003b808079bb4b26517560624ba134230/task453d91672b6c4a1e94b611450b66767e.json",
  "utf8",
));

const BASE = "https://api.kunrouai.com/v1";
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const images = [];
for (const index of indices) {
  const meta = task.request.images[index];
  if (!meta) continue;
  const full = `D:/wuxianhuabudate/${meta.path}`;
  const bytes = readFileSync(full);
  const mime = meta.mimeType || (full.endsWith(".png") ? "image/png" : "image/jpeg");
  images.push(`data:${mime};base64,${bytes.toString("base64")}`);
  console.log(`参考图[${index}]`, (bytes.length / 1024 / 1024).toFixed(2) + "MB", "->", (images.at(-1)!.length / 1024 / 1024).toFixed(2) + "MB base64");
}

const body: Record<string, unknown> = {
  model: "gemini-omni-1.1-flash",
  prompt: task.request.prompt,
  duration: 4,
  resolution: "720p",
  aspect_ratio: "16:9",
};
if (images.length) body.reference_images = images;

console.log(new Date().toISOString().slice(11, 19), `提交：提示词 + ${images.length} 张参考图`);
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
