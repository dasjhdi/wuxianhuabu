// 列出坤柔平台可用的模型，按类型归类
import { readFileSync } from "node:fs";

const settings = JSON.parse(readFileSync("D:/wuxianhuabu/Toonflow-app/data/settings.json", "utf8"));
const apiKey = settings?.settings?.mediaProviderConfigs?.kunrou?.apiKey;

const res = await fetch("https://api.kunrouai.com/v1/models", {
  headers: { Authorization: `Bearer ${apiKey}` },
});
console.log("状态:", res.status);
const text = await res.text();
let parsed: any = {};
try { parsed = JSON.parse(text); } catch { console.log(text.slice(0, 400)); process.exit(0); }

const list: any[] = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.models ?? []);
console.log("模型总数:", list.length);
for (const item of list) {
  const id = item.id ?? item.name ?? item.model;
  const extra = [item.type, item.owned_by, item.group].filter(Boolean).join(" / ");
  console.log(" -", id, extra ? `(${extra})` : "");
}
