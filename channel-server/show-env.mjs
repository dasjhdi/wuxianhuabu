import { readFileSync } from "node:fs";

const lines = readFileSync(".env", "utf8").split(/\r?\n/);
for (const line of lines) {
  const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (!match) continue;
  const [, key, value] = match;
  if (key === "CHANNEL_UPSTREAM_KEY") {
    const shown = value ? `${value.slice(0, 5)}...${value.slice(-4)} (长度 ${value.length})` : "(空)";
    console.log(key.padEnd(26), "=", shown);
  } else {
    console.log(key.padEnd(26), "=", value || "(空)");
  }
}
