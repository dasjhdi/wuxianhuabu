import { lstat, readFile } from "@toonflow/file";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { sendFile } from "@/utils/fileHttp";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";


const THUMBNAIL_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

async function ensureThumbnail(source: string, width: number, mtimeMs: number, size: number, video = false) {
  // ACT: 缩略图按「源文件+尺寸」缓存，源文件变化会生成新 key，避免读到旧图。
  // ACT: key 含编码版本，切换编码格式后不会复用旧文件。
  const key = createHash("sha1").update(`${source}:${mtimeMs}:${size}:${width}:webp1${video ? ":v" : ""}`).digest("hex");
  const directory = resolve(dirname(u.conf.path), "thumbs");
  const target = resolve(directory, `${key}.webp`);
  if (existsSync(target)) return target;
  await mkdir(directory, { recursive: true });
  const ffmpeg = resolve(dirname(u.conf.path), "ffmpeg", "win32-x64", "ffmpeg.exe");
  if (!existsSync(ffmpeg)) return null;
  const temp = `${target}.${process.pid}.webp`;
  const code = await new Promise<number>(done => {
    const args = ["-hide_banner", "-loglevel", "error", "-y"];
    if (video) args.push("-ss", "0.3");
    args.push("-i", source);
    if (video) args.push("-frames:v", "1");
    args.push("-vf", `scale=w='min(${width},iw)':h=-2`, "-c:v", "libwebp", "-quality", "80", temp);
    const child = spawn(ffmpeg, args);
    child.on("error", () => done(1));
    child.on("close", value => done(value ?? 1));
  });
  if (code !== 0 || !existsSync(temp)) return null;
  await rename(temp, target).catch(() => {});
  return existsSync(target) ? target : null;
}

const router = Router();

export default router.get("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().max(4096), snapshot: z.enum(["true"]).optional(), maxBytes: z.coerce.number().int().positive().max(20 * 1024 * 1024).optional(), w: z.coerce.number().int().min(64).max(4096).optional() }, "query"), async (req, res, next) => {
  const { path } = await u.workspaceFile.resolveWorkspaceFile(req, req.query.directory as string, req.query.path as string);
  const file = await lstat(path);
  if (!file.isFile()) throw Object.assign(new Error("只能读取文件"), { status: 400 });
  // ACT: 媒体文件按内容寻址（uuid 命名），可长期缓存；文本/画布文件必须实时，避免覆盖后读到旧内容。
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  const immutable = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".m4a", ".ogg", ".flac"].includes(extension);
  res.set("Cache-Control", immutable ? "public, max-age=604800, immutable" : "no-store");
  const isVideo = VIDEO_EXTENSIONS.has(extension);
  if (req.query.w !== undefined && (THUMBNAIL_EXTENSIONS.has(extension) || isVideo)) {
    const thumbnail = await ensureThumbnail(path, Number(req.query.w), file.mtimeMs, file.size, isVideo);
    if (thumbnail) {
      res.set("Content-Type", "image/webp");
      await sendFile(res, thumbnail, {}, err => { if (err) next(err); });
      return;
    }
  }
  if (req.query.snapshot === "true") {
    const maxBytes = req.query.maxBytes === undefined ? undefined : Number(req.query.maxBytes);
    if (maxBytes !== undefined && file.size > maxBytes) throw Object.assign(new Error("文件超过本次文本读取的大小限制"), { status: 413 });
    const bytes = await readFile(path);
    if (maxBytes !== undefined && bytes.length > maxBytes) throw Object.assign(new Error("文件超过本次文本读取的大小限制"), { status: 413 });
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be"
        : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8-bom" : "utf-8";
    let text: string;
    try {
      text = new TextDecoder(encoding === "utf-8-bom" ? "utf-8" : encoding, { fatal: true }).decode(bytes);
      if (text.includes("\0")) throw new Error("binary");
    } catch {
      throw Object.assign(new Error("文件不是受支持的 UTF-8 或带 BOM 的 UTF-16 文本，请先用原编辑器转换编码后再打开，原文件未修改"), { status: 415 });
    }
    res.json(success({ text, encoding, revision: createHash("sha256").update(bytes).digest("hex") }));
    return;
  }
  await sendFile(res, path, { dotfiles: "allow" }, err => { if (err) next(err); });
});
