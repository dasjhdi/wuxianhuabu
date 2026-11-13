import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split(/\r?\n/).map(line => {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    return match ? [match[1], match[2]] : null;
  }).filter(Boolean)
);

const base = env.CHANNEL_UPSTREAM_BASE.replace(/\/+$/, "");
const key = env.CHANNEL_UPSTREAM_KEY;

for (const path of ["/v1/models", "/models"]) {
  try {
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${key}` } });
    const body = await response.text();
    console.log(`GET ${path} -> ${response.status} ${body.slice(0, 120).replace(/\s+/g, " ")}`);
  } catch (error) {
    console.log(`GET ${path} -> 网络错误 ${error.message}`);
  }
}

for (const path of ["/v1/chat/completions", "/chat/completions"]) {
  try {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "hi" }], max_tokens: 8 }),
    });
    const body = await response.text();
    console.log(`POST ${path} -> ${response.status} ${body.slice(0, 160).replace(/\s+/g, " ")}`);
  } catch (error) {
    console.log(`POST ${path} -> 网络错误 ${error.message}`);
  }
}
