// 验证：运行中的配置存储是否把 kunrou 的 apiKey 注入到供应商上下文
import conf from "D:/wuxianhuabu/Toonflow-app/apps/server/src/utils/conf/index.ts";
import { getMediaProvider, loadMediaProviderSource } from "D:/wuxianhuabu/Toonflow-app/apps/server/src/utils/media/provider.ts";

const settings = conf.get("settings", {}) as Record<string, unknown>;
const configs = (settings.mediaProviderConfigs ?? {}) as Record<string, Record<string, unknown>>;
console.log("配置库中的提供方:", Object.keys(configs));
for (const [id, value] of Object.entries(configs)) {
  const key = typeof value?.apiKey === "string" ? value.apiKey : "";
  console.log(` - ${id}: apiKey ${key ? `已填（${key.length} 位，${key.slice(0, 4)}…）` : "空"}`);
}

const info = await getMediaProvider("kunrou");
console.log("供应商文件:", info.fileName, "| 模型:", info.models.map(model => `${model.id}(${model.type})`).join(", "));
const provider = await loadMediaProviderSource(info.source, configs.kunrou ?? {});
console.log("注入后的 config 键:", Object.keys(provider.config ?? {}));
console.log("apiKey 是否可用:", Boolean((provider.config as { apiKey?: string })?.apiKey?.trim()));
console.log("是否实现 generateVideo:", typeof (provider as { generateVideo?: unknown }).generateVideo);
