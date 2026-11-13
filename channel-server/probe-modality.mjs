import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split(/\r?\n/).map(line => {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    return match ? [match[1], match[2]] : null;
  }).filter(Boolean)
);

const base = env.CHANNEL_UPSTREAM_BASE.replace(/\/+$/, "");
const response = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${env.CHANNEL_UPSTREAM_KEY}` } });
const body = await response.json();
const target = body.data.find(item => /4\.1-flash/i.test(item.id)) ?? body.data[0];
console.log("单条模型元数据：");
console.log(JSON.stringify(target, null, 2));
console.log("\n全部模型字段名：", [...new Set(body.data.flatMap(item => Object.keys(item)))].join(", "));
