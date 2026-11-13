// 最小化对照测试：纯文本、无参考素材、安全提示词
import { readFileSync } from "node:fs";

const settings = JSON.parse(readFileSync("D:/wuxianhuabu/Toonflow-app/data/settings.json", "utf8"));
const apiKey = settings?.settings?.mediaProviderConfigs?.kunrou?.apiKey;
if (!apiKey) throw new Error("未找到 kunrou 的 API Key");

const BASE = "https://api.kunrouai.com/v1";
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

function log(...args: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

const body = {
  model: "gemini-omni-1.1-flash",
  prompt: "一只纸船在雨后水洼中缓慢漂流，电影感自然光，镜头稳定。",
  duration: 4,
  resolution: "720p",
  aspect_ratio: "16:9",
};

log("提交纯文本任务");
const created = await fetch(`${BASE}/videos`, { method: "POST", headers, body: JSON.stringify(body) });
const createdText = await created.text();
log("提交状态:", created.status);
log("提交响应:", createdText.slice(0, 600));

let taskId = "";
try {
  const parsed = JSON.parse(createdText);
  taskId = parsed?.id ?? parsed?.task_id ?? parsed?.data?.id ?? "";
} catch {}
if (!created.ok || !taskId) {
  log("提交阶段即失败，无需轮询");
  process.exit(0);
}

const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const res = await fetch(`${BASE}/videos/${encodeURIComponent(taskId)}`, { headers });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch {}
  log("轮询:", parsed?.status ?? res.status, "进度", parsed?.progress ?? "-");
  if (parsed?.status === "completed") {
    console.log("\n完成，成片:", parsed?.url ?? JSON.stringify(parsed?.output)?.slice(0, 200));
    process.exit(0);
  }
  if (parsed?.status === "failed") {
    console.log("\n平台失败原文:", JSON.stringify(parsed?.error ?? parsed).slice(0, 800));
    process.exit(0);
  }
}
log("超时，任务仍执行中:", taskId);
