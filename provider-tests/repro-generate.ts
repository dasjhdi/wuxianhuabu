// 复现应用内生成失败：直接调用服务端 generateMedia，打印真实异常
import { readFileSync } from "node:fs";
import { generateMedia } from "D:/wuxianhuabu/Toonflow-app/apps/server/src/utils/media/generation.ts";

const taskFile = "D:/wuxianhuabu/Toonflow-app/data/mediaTasks/workspacedf21467c46fa559f61cb5e4973c7d1f003b808079bb4b26517560624ba134230/task2db02c1635c74c918e5465ee04910a35.json";
const task = JSON.parse(readFileSync(taskFile, "utf8"));
const cwd = task.cwd as string;
const request = task.request as Record<string, unknown>;

console.log("cwd:", cwd);
console.log("模型:", request.modelId, "| 模式:", JSON.stringify(request.mode), "| 图片:", (request.images as unknown[] | undefined)?.length);

const controller = new AbortController();
try {
  const files = await generateMedia(cwd, "video", request as never, controller.signal);
  console.log("✅ 生成成功:", JSON.stringify(files).slice(0, 300));
} catch (cause) {
  const error = cause as Error & { code?: string; status?: number; cause?: unknown };
  console.log("\n❌ 抛出异常");
  console.log("name:", error?.name);
  console.log("message:", error?.message);
  console.log("code:", error?.code, "| status:", error?.status);
  console.log("stack:\n", String(error?.stack).split("\n").slice(0, 8).join("\n"));
  if (error?.cause) console.log("cause:", String(error.cause).slice(0, 300));
}
