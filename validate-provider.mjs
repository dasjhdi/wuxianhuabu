// 用创梦自身的供应商校验器验证适配文件
import { readFileSync } from "node:fs";
import { validateMediaProviderSource } from "D:/wuxianhuabu/Toonflow-app/apps/server/src/utils/media/provider.ts";

const source = readFileSync("D:/wuxianhuabu/custom-providers/kunrou.ts", "utf8");
try {
  const result = validateMediaProviderSource(source);
  console.log("校验通过");
  console.log(JSON.stringify(result, null, 2).slice(0, 800));
} catch (error) {
  console.log("校验失败：", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
