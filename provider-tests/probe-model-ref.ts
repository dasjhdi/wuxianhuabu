// 通用探测：指定模型 + 同一张人物定妆图，判断各模型对「参考图」策略是否不同
// 用法：bun run probe-model-ref.ts <model> <reference|firstframe> [imageIndex] [duration]
import { readFileSync } from "node:fs";

const [model, mode = "reference", imageIndexArg = "2", durationArg = ""] = process.argv.slice(2);
if (!model) {
  console.log("用法: bun run probe-model-ref.ts <model> <reference|firstframe> [imageIndex] [duration]");
  process.exit(1);
}

const settings = JSON.parse(readFileSync("D:/wuxianhuabu/Toonflow-app/data/settings.json", "utf8"));
const apiKey = settings?.settings?.mediaProviderConfigs?.kunrou?.apiKey as string;
const task = JSON.parse(readFileSync(
  "D:/wuxianhuabu/Toonflow-app/data/mediaTasks/workspacedf21467c46fa559f61cb5e4973c7d1f003b808079bb4b26517560624ba134230/task453d91672b6c4a1e94b611450b66767e.json",
  "utf8",
));

const indices = imageIndexArg === "all"
  ? task.request.images.map((_: unknown, index: number) => index)
  : [Number(imageIndexArg)];

const urls = indices.map((index: number) => {
  const meta = task.request.images[index];
  const bytes = readFileSync(`D:/wuxianhuabudate/${meta.path}`);
  return `data:${meta.mimeType};base64,${bytes.toString("base64")}`;
});

const BASE = "https://api.kunrouai.com/v1";
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const body: Record<string, unknown> = {
  model,
  prompt: "镜头缓慢推近，人物保持站立不动，自然光，画面稳定。",
  resolution: "720p",
  aspect_ratio: "16:9",
};
if (durationArg) body.duration = Number(durationArg);
body.reference_images = mode === "firstframe"
  ? [{ url: urls[0], role: "first_frame" }]
  : urls.map(url => ({ url, role: "reference" }));

const stamp = () => new Date().toISOString().slice(11, 19);
console.log(stamp(), `模型=${model} 模式=${mode} 参考图=${urls.length} 张 时长=${durationArg || "默认"}`);
const created = await fetch(`${BASE}/videos`, { method: "POST", headers, body: JSON.stringify(body) });
const createdText = await created.text();
console.log(stamp(), "提交状态:", created.status, createdText.slice(0, 300));

let taskId = "";
try { taskId = JSON.parse(createdText)?.id ?? ""; } catch {}
if (!created.ok || !taskId) process.exit(0);

const deadline = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const res = await fetch(`${BASE}/videos/${encodeURIComponent(taskId)}`, { headers });
  let parsed: any = {};
  try { parsed = JSON.parse(await res.text()); } catch {}
  console.log(stamp(), "轮询:", parsed?.status ?? res.status, parsed?.progress ?? "-");
  if (parsed?.status === "completed") {
    console.log("\n✅ 成功", parsed?.url ?? "", "| 实际时长", parsed?.seconds ?? "-", "| 尺寸", parsed?.size ?? "-");
    process.exit(0);
  }
  if (parsed?.status === "failed") {
    console.log("\n❌ 失败:", JSON.stringify(parsed?.error ?? parsed).slice(0, 500));
    process.exit(0);
  }
}
console.log("超时:", taskId);
