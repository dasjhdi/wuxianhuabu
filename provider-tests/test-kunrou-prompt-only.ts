// 对照 B：使用失败任务完全相同的提示词，但不带任何参考素材
import { readFileSync } from "node:fs";

const settings = JSON.parse(readFileSync("D:/wuxianhuabu/Toonflow-app/data/settings.json", "utf8"));
const apiKey = settings?.settings?.mediaProviderConfigs?.kunrou?.apiKey;
if (!apiKey) throw new Error("未找到 kunrou 的 API Key");

const task = JSON.parse(readFileSync(
  "D:/wuxianhuabu/Toonflow-app/data/mediaTasks/workspacedf21467c46fa559f61cb5e4973c7d1f003b808079bb4b26517560624ba134230/task453d91672b6c4a1e94b611450b66767e.json",
  "utf8",
));

const BASE = "https://api.kunrouai.com/v1";
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const body = {
  model: "gemini-omni-1.1-flash",
  prompt: task.request.prompt,
  duration: 4,
  resolution: "720p",
  aspect_ratio: "16:9",
};

console.log(new Date().toISOString().slice(11, 19), "提交：原始提示词 / 无参考素材，长度", body.prompt.length);
const created = await fetch(`${BASE}/videos`, { method: "POST", headers, body: JSON.stringify(body) });
const createdText = await created.text();
console.log("提交状态:", created.status, createdText.slice(0, 300));

let taskId = "";
try { taskId = JSON.parse(createdText)?.id ?? ""; } catch {}
if (!created.ok || !taskId) process.exit(0);

const deadline = Date.now() + 6 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const res = await fetch(`${BASE}/videos/${encodeURIComponent(taskId)}`, { headers });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch {}
  console.log(new Date().toISOString().slice(11, 19), "轮询:", parsed?.status ?? res.status, parsed?.progress ?? "-");
  if (parsed?.status === "completed") {
    console.log("\n结果：成功", parsed?.url ?? "");
    process.exit(0);
  }
  if (parsed?.status === "failed") {
    console.log("\n结果：失败，平台原文:", JSON.stringify(parsed?.error ?? parsed).slice(0, 600));
    process.exit(0);
  }
}
console.log("超时，任务仍执行中:", taskId);
