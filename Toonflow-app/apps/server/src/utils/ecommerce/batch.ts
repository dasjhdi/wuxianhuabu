import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface CsvRow {
  title: string;
  category: string;
  points: string[];
  imageUrl: string;
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter(item => item.some(value => value.trim()));
}

export function parseSkuCsv(text: string): CsvRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map(value => value.trim().toLowerCase());
  const hasHeader = header.some(value => ["title", "标题", "商品标题"].includes(value));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const find = (names: string[], fallback: number) => {
    const index = header.findIndex(value => names.includes(value));
    return index >= 0 ? index : fallback;
  };
  const titleIndex = find(["title", "标题", "商品标题"], 0);
  const categoryIndex = find(["category", "类目", "分类"], 1);
  const pointsIndex = find(["sellingpoints", "selling_points", "卖点", "points"], 2);
  const imageIndex = find(["image", "imageurl", "image_url", "图片", "图片地址"], 3);
  return dataRows.slice(0, 20).map((row, index) => ({
    title: (row[titleIndex] ?? "").trim() || `SKU ${index + 1}`,
    category: (row[categoryIndex] ?? "").trim(),
    points: (row[pointsIndex] ?? "").split(/[|;；]/).map(value => value.trim()).filter(Boolean).slice(0, 4),
    imageUrl: (row[imageIndex] ?? "").trim(),
  }));
}

// ACT: 批量图片地址由用户提供，必须拦截内网、回环与云元数据地址，避免服务端被当作内网探测跳板。
const privateV4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.(18|19)\./,
  /^(22[4-9]|2[3-5]\d)\./,
];

function isPrivateAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return privateV4.some(pattern => pattern.test(address));
  if (family === 6) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
    if (value.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(value)) return true;
    return value.startsWith("ff");
  }
  return true;
}

async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("图片地址指向内网，已拒绝");
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("图片地址指向内网，已拒绝");
    return;
  }
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new Error("图片地址无法解析");
  if (addresses.some(item => isPrivateAddress(item.address))) throw new Error("图片地址指向内网，已拒绝");
}

async function fetchImage(url: URL, signal: AbortSignal, hops = 0): Promise<Response> {
  if (hops > 3) throw new Error("图片地址重定向过多");
  await assertPublicHost(url.hostname);
  const response = await fetch(url, { redirect: "manual", signal });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("图片地址重定向无效");
    const next = new URL(location, url);
    if (next.protocol !== "http:" && next.protocol !== "https:") throw new Error("图片地址必须是 HTTP(S)");
    return fetchImage(next, signal, hops + 1);
  }
  return response;
}

export async function downloadImage(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("图片地址无效");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("图片地址必须是 HTTP(S)");
  const response = await fetchImage(parsed, AbortSignal.timeout(30_000));
  if (!response.ok) throw new Error(`下载图片失败（${response.status}）`);
  const mimeType = response.headers.get("content-type") ?? "image/jpeg";
  if (!mimeType.startsWith("image/")) throw new Error("图片地址返回的不是图片");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("图片超过 20 MB");
  return { data: Buffer.from(bytes).toString("base64"), mimeType };
}
