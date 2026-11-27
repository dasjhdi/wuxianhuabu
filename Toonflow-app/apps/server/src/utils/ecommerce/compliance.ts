import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareWorkspaceFfmpeg } from "@/utils/ffmpeg";

const exec = promisify(execFile);

// ACT: 白底纯度取画面上沿 3% 的像素统计，商品合成在画面中下部，顶部必然是背景。
export async function measureWhitePurity(file: string) {
  const { ffmpeg } = await prepareWorkspaceFfmpeg();
  const stdout = await exec(ffmpeg, [
    "-hide_banner", "-i", file,
    "-vf", "crop=iw:trunc(ih*0.03):0:0,signalstats,metadata=mode=print:file=-",
    "-frames:v", "1", "-f", "null", "-",
  ], { maxBuffer: 8 * 1024 * 1024, encoding: "utf8" })
    .then(result => String(result.stdout ?? ""))
    .catch(error => String(error?.stdout ?? ""));
  const read = (key: string) => {
    const match = new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.]+)`).exec(stdout);
    return match ? Number(match[1]) : null;
  };
  const y = read("YAVG");
  const u = read("UAVG");
  const v = read("VAVG");
  if (y === null) return null;
  const neutralityU = u === null ? 1 : Math.max(0, 1 - Math.abs(u - 128) / 32);
  const neutralityV = v === null ? 1 : Math.max(0, 1 - Math.abs(v - 128) / 32);
  const score = Math.min(y / 255, neutralityU, neutralityV);
  return {
    y,
    u,
    v,
    percent: Math.round(score * 1000) / 10,
    pass: y >= 250 && (u === null || Math.abs(u - 128) <= 6) && (v === null || Math.abs(v - 128) <= 6),
  };
}

export async function probeImageSize(file: string) {
  const { ffprobe } = await prepareWorkspaceFfmpeg();
  const { stdout } = await exec(ffprobe, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0", file,
  ], { maxBuffer: 1024 * 1024 });
  const [width, height] = String(stdout).trim().split(",").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

// ACT: 直接读 alpha 原始像素求边界，比 cropdetect 的日志解析稳定，也不依赖 ffmpeg 日志级别。
export async function measureOpaqueBox(file: string, width: number, height: number) {
  const { ffmpeg } = await prepareWorkspaceFfmpeg();
  const stdout = await exec(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-i", file,
    "-vf", "alphaextract,format=gray",
    "-frames:v", "1", "-f", "rawvideo", "-",
  ], { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" })
    .then(result => result.stdout as Buffer)
    .catch(error => (error?.stdout as Buffer) ?? Buffer.alloc(0));
  if (stdout.length < width * height) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const offset = y * width;
    for (let x = 0; x < width; x += 1) {
      if (stdout[offset + x] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

export interface SubjectBase {
  boxWidth: number;
  boxHeight: number;
  imageWidth: number;
  imageHeight: number;
}

export function measureSubject(file: string) {
  return probeImageSize(file).then(async size => {
    if (!size) return null;
    const box = await measureOpaqueBox(file, size.width, size.height);
    if (!box) return null;
    return { boxWidth: box.width, boxHeight: box.height, imageWidth: size.width, imageHeight: size.height } satisfies SubjectBase;
  });
}

// ACT: 与 compose 的缩放规则保持一致（宽高双约束），算出商品在成品画布中的实际占比。
export function subjectRatio(base: SubjectBase, spec: { width: number; height: number }, compose: { scale: number; bottomGap: number }) {
  const maxWidth = spec.width * compose.scale;
  const maxHeight = spec.height * Math.max(0.4, 1 - compose.bottomGap - 0.06);
  const scale = Math.min(maxWidth / base.imageWidth, maxHeight / base.imageHeight);
  return {
    width: (base.boxWidth * scale) / spec.width,
    height: (base.boxHeight * scale) / spec.height,
  };
}

export function formatSubject(ratios: { width: number; height: number }[]) {
  if (!ratios.length) return null;
  const percent = (value: number) => Math.round(value * 100);
  const range = (min: number, max: number) => (min === max ? `${min}%` : `${min}%–${max}%`);
  const widths = ratios.map(item => item.width);
  const heights = ratios.map(item => item.height);
  const minW = percent(Math.min(...widths));
  const maxW = percent(Math.max(...widths));
  const minH = percent(Math.min(...heights));
  const maxH = percent(Math.max(...heights));
  const edge = ratios.some(item => item.width > 0.92 || item.height > 0.92);
  const weak = ratios.some(item => Math.max(item.width, item.height) < 0.6);
  const note = edge ? "存在贴边" : weak ? "存在主体偏小" : "通过";
  return `宽 ${range(minW, maxW)}、高 ${range(minH, maxH)}（建议 60%–90%，${note}）`;
}
