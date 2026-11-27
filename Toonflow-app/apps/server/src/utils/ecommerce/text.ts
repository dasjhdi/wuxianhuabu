import { existsSync } from "node:fs";

const fontCandidates = process.platform === "win32"
  ? ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf"]
  : process.platform === "darwin"
  ? ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]
  : ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"];

export function fontFile() {
  return fontCandidates.find(candidate => existsSync(candidate)) ?? null;
}

export function cleanText(text: string) {
  return text
    .replace(/[\\'"]/g, "")
    .replace(/:/g, "：")
    .replace(/,/g, "，")
    .replace(/%/g, "％")
    .replace(/\r?\n/g, " ")
    .trim();
}

export function splitLines(text: string, max = 12, limit = 2) {
  const lines: string[] = [];
  let current = "";
  for (const char of text) {
    current += char;
    if (current.length >= max) {
      lines.push(current);
      current = "";
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, limit);
}

export function drawText(input: {
  text: string;
  x: number | string;
  y: number | string;
  size: number;
  color?: string;
  box?: boolean;
  boxColor?: string;
  enable?: string;
}) {
  const font = fontFile();
  if (!font) return null;
  const path = font.replace(/\\/g, "/").replace(/:/g, "\\:");
  const box = input.box === false ? "" : `:box=1:boxcolor=${input.boxColor ?? "black@0.42"}:boxborderw=${Math.round(input.size * 0.32)}`;
  const enable = input.enable ? `:enable='${input.enable}'` : "";
  return `drawtext=fontfile='${path}':text='${cleanText(input.text)}':fontsize=${input.size}:fontcolor=${input.color ?? "white"}${box}:x=${input.x}:y=${input.y}${enable}`;
}

// ACT: AI 生成内容需要显式标识；角标固定左下角，字号随画面宽度缩放，图片与视频共用同一套样式。
export function aiLabelFilter(width: number, height: number) {
  const size = Math.max(11, Math.round(width * 0.02));
  return drawText({
    text: "AI 生成",
    x: Math.round(width * 0.03),
    y: height - size * 2,
    size,
    color: "white@0.82",
    boxColor: "black@0.28",
  });
}
