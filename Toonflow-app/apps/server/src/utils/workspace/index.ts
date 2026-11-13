import type { Request } from "express";
import { realpath, stat } from "@toonflow/file";
import { delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import conf from "@/utils/conf";
import { getMobileLinkConfig, isMobileLinkRequest } from "@/utils/mobileLink";
import { getRuntimePlatform } from "@/lib/platform";

/** 局域网/公网共享目录：由 TOONFLOW_SHARED_WORKSPACES 显式声明，默认不开放。 */
let sharedWorkspaceCache: { raw: string; roots: string[] } | undefined;

async function sharedWorkspaceRoots() {
  const raw = process.env.TOONFLOW_SHARED_WORKSPACES ?? "";
  if (sharedWorkspaceCache?.raw === raw) return sharedWorkspaceCache.roots;
  const roots: string[] = [];
  for (const candidate of raw.split(delimiter).map(value => value.trim()).filter(Boolean)) {
    const resolved = await realpath(candidate).catch(() => null);
    if (resolved) roots.push(resolved);
  }
  sharedWorkspaceCache = { raw, roots };
  return roots;
}

export function isLocalWorkspaceRequest(req: Request) {
  if (isMobileLinkRequest(req)) return false;
  const localAddress = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") && req.get("x-toonflow-local-client") !== "0";
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(req.hostname);
  const origin = req.get("origin");
  const localOrigin = `${req.protocol}://${req.get("host")}`;
  const sameOrigin = origin === undefined ? req.get("referer")?.startsWith(`${localOrigin}/`) : origin === localOrigin;
  return localAddress && localHost && sameOrigin && req.get("x-toonflow-workspace") === "1";
}

export async function resolveWorkspace(req: Request, path: string) {
  if (!isAbsolute(path)) throw Object.assign(new Error("工作目录必须是绝对路径"), { status: 400 });
  const directory = await realpath(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") throw Object.assign(new Error("工作目录不存在，请重新选择文件夹"), { status: 404 });
    throw err;
  });
  if (!(await stat(directory)).isDirectory()) throw Object.assign(new Error("工作目录不是文件夹，请重新选择"), { status: 404 });
  if (getRuntimePlatform().local && isLocalWorkspaceRequest(req)) return directory;

  if (isMobileLinkRequest(req)) {
    for (const root of getMobileLinkConfig().directories) {
      const offset = relative(root, directory);
      if (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) return directory;
    }
  }

  // ACT: 显式声明的共享目录对同网段/公网访客开放，用于局域网协作。
  for (const shared of await sharedWorkspaceRoots()) {
    const offset = relative(shared, directory);
    if (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) return directory;
  }

  const root = await realpath(resolve(dirname(conf.path), "workspaces")).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (root) {
    const offset = relative(root, directory);
    if (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) return directory;
  }
  throw Object.assign(new Error("服务器部署只能使用服务器工作区"), { status: 403 });
}
