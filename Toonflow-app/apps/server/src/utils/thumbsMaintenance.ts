import { readdir, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import conf from "@/utils/conf";

/** 缩略图缓存保留时长：超过后下次访问会自动重新生成。 */
const THUMBS_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

async function cleanupThumbs() {
  const directory = resolve(dirname(conf.path), "thumbs");
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - THUMBS_MAX_AGE_MS;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const target = resolve(directory, entry.name);
    const info = await stat(target).catch(() => undefined);
    if (info?.mtimeMs && info.mtimeMs < cutoff) await unlink(target).catch(() => {});
  }
}

// ACT: 缩略图按源文件版本换 key，旧版本会永久残留；定期清理 7 天未访问的缓存防止膨胀。
export function scheduleThumbsCleanup(intervalMs = 24 * 3600 * 1000) {
  const timer = setInterval(() => void cleanupThumbs().catch(() => {}), intervalMs);
  timer.unref?.();
  void cleanupThumbs().catch(() => {});
}
