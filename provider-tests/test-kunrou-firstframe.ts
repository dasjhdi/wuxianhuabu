// 同一张人物图，改用 first_frame 角色提交，判断限制是「人物内容」还是「reference 角色」
import { readFileSync } from "node:fs";

const settings = JSON.parse(readFileSync("D:/wuxianhuabu/Toonflow-app/data/settings.json", "utf8"));
const apiKey = settings?.settings?.mediaProviderConfigs?.kunrou?.apiKey;
const task = JSON.parse(readFileSync(
  "D:/wuxianhuabu/Toonflow-app/data/mediaTasks/workspacedf21467c46fa559f61cb5e4973c7d1f003b808079bb4b26517560624ba134230/task453d91672b6c4a1e94b611450b66767e.json",
  "utf8",
));

const BASE = "https://api.kunrouai.com/v1";
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const meta = task.request.images[2];
const bytes = readFileSync(`D:/wuxianhuabudate/${meta.path}`);
const dataUrl = `data:${meta.mimeType};base64,${bytes.toString("base64")}`;

const body = {
  model: "gemini-omni-1.1-flash",
  prompt: "镜头从人物正面缓慢推近，光线自然，人物保持静止。",
  duration: 4,
  resolution: "720p",
  aspect_ratio: "16:9",
  reference_images: [{ url: dataUrl, role: "first_frame" }],
};

console.log(new Date().toISOString().slice(11, 19), "提交：同一张人物图，role=first_frame");
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
