import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import conf from "@/utils/conf";
import { getDb } from "@/utils/auth";

export interface ProjectSummary {
  name: string;
  canvasCount: number;
  assetCount: number;
  size: number;
  updatedAt: number;
}

async function directoryMetrics(directory: string, depth = 0): Promise<{ size: number; files: number; updatedAt: number }> {
  let size = 0;
  let files = 0;
  let updatedAt = 0;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = resolve(directory, entry.name);
    const info = await stat(target).catch(() => null);
    if (!info) continue;
    updatedAt = Math.max(updatedAt, info.mtimeMs);
    if (entry.isDirectory()) {
      if (depth >= 4) continue;
      const nested = await directoryMetrics(target, depth + 1);
      size += nested.size;
      files += nested.files;
      updatedAt = Math.max(updatedAt, nested.updatedAt);
    } else if (entry.isFile()) {
      size += info.size;
      files += 1;
    }
  }
  return { size, files, updatedAt };
}

export function workspaceRoot() {
  return resolve(dirname(conf.path), "workspaces");
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const root = workspaceRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const projects = await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith(".")).map(async entry => {
    const directory = resolve(root, entry.name);
    const [metrics, files] = await Promise.all([directoryMetrics(directory), readdir(directory, { withFileTypes: true }).catch(() => [])]);
    const canvasCount = files.filter(file => file.isFile() && file.name.endsWith(".json") && !file.name.includes(".bak-")).length;
    const assetDirectory = resolve(directory, "assets");
    const assetCount = (await readdir(assetDirectory, { withFileTypes: true }).catch(() => [])).filter(file => file.isFile()).length;
    return { name: entry.name, canvasCount, assetCount, size: metrics.size, updatedAt: Math.round(metrics.updatedAt || 0) } satisfies ProjectSummary;
  }));
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function moveProjectToTrash(name: string) {
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") throw Object.assign(new Error("项目名称不合法"), { status: 400 });
  const root = workspaceRoot();
  const source = resolve(root, name);
  if (!source.startsWith(root)) throw Object.assign(new Error("只能删除工作区内的项目"), { status: 403 });
  const info = await stat(source).catch(() => null);
  if (!info?.isDirectory()) throw Object.assign(new Error("项目不存在"), { status: 404 });
  const trash = resolve(dirname(conf.path), ".trash");
  await mkdir(trash, { recursive: true });
  const target = resolve(trash, `${name}-${Date.now()}`);
  await rename(source, target);
  return target;
}

export function providerSummary() {
  const settings = conf.get("settings", {}) as Record<string, unknown>;
  const items: { id: string; name: string; models: number; configured: boolean; kind: "custom" | "media" | "account" }[] = [];
  const custom = Array.isArray(settings.customProviders) ? settings.customProviders as Record<string, unknown>[] : [];
  for (const provider of custom) {
    items.push({
      id: String(provider.id ?? provider.label ?? "custom"),
      name: String(provider.label ?? provider.id ?? "自定义供应商"),
      models: Array.isArray(provider.models) ? provider.models.length : 0,
      configured: typeof provider.apiKey === "string" && provider.apiKey.length > 0,
      kind: "custom",
    });
  }
  const account = settings.toonflowAccount as { token?: unknown; info?: { userName?: unknown } } | undefined;
  items.push({
    id: "toonflow",
    name: typeof account?.info?.userName === "string" && account.info.userName ? `创梦账号（${account.info.userName}）` : "创梦官方账号",
    models: 0,
    configured: typeof account?.token === "string" && account.token.length > 0,
    kind: "account",
  });
  const media = settings.mediaProviderConfigs && typeof settings.mediaProviderConfigs === "object"
    ? settings.mediaProviderConfigs as Record<string, Record<string, unknown>> : {};
  for (const [id, config] of Object.entries(media)) {
    items.push({
      id,
      name: typeof config.label === "string" ? config.label : id,
      models: 0,
      configured: Object.keys(config).some(key => /key|token|secret/i.test(key) && typeof config[key] === "string" && (config[key] as string).length > 0),
      kind: "media",
    });
  }
  return items;
}

export function overviewStats() {
  const db = getDb();
  const userStats = db.query("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins FROM users").get() as { total: number; active: number | null; admins: number | null };
  const usage = db.query("SELECT COUNT(*) AS total, SUM(CASE WHEN status < 400 THEN 1 ELSE 0 END) AS success FROM usage_records WHERE created_at >= ?").get(Date.now() - 24 * 60 * 60 * 1000) as { total: number; success: number | null };
  const audit = db.query("SELECT COUNT(*) AS total FROM audit_logs WHERE created_at >= ?").get(Date.now() - 24 * 60 * 60 * 1000) as { total: number };
  return { userStats, usage, audit };
}

export function usageTrend(days: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  const rows = getDb().query(
    `SELECT kind, model, username, status, duration_ms, created_at FROM usage_records WHERE created_at >= ? ORDER BY created_at ASC`,
  ).all(start.getTime()) as { kind: string; model: string | null; username: string | null; status: number; duration_ms: number; created_at: number }[];
  const byDay = new Map<string, { date: string; image: number; video: number; audio: number; text: number; total: number; failed: number }>();
  for (let index = 0; index < days; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    byDay.set(key, { date: key, image: 0, video: 0, audio: 0, text: 0, total: 0, failed: 0 });
  }
  const byModel = new Map<string, { model: string; kind: string; count: number; failed: number; totalMs: number }>();
  const byUser = new Map<string, { username: string; count: number; failed: number }>();
  for (const row of rows) {
    const date = new Date(row.created_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.total += 1;
      if (row.kind === "image" || row.kind === "video" || row.kind === "audio" || row.kind === "text") bucket[row.kind] += 1;
      if (row.status >= 400) bucket.failed += 1;
    }
    const modelKey = `${row.kind}:${row.model ?? "未知"}`;
    const model = byModel.get(modelKey) ?? { model: row.model ?? "未知", kind: row.kind, count: 0, failed: 0, totalMs: 0 };
    model.count += 1;
    model.totalMs += row.duration_ms;
    if (row.status >= 400) model.failed += 1;
    byModel.set(modelKey, model);
    const userKey = row.username ?? "未登录";
    const user = byUser.get(userKey) ?? { username: userKey, count: 0, failed: 0 };
    user.count += 1;
    if (row.status >= 400) user.failed += 1;
    byUser.set(userKey, user);
  }
  return {
    days: [...byDay.values()],
    models: [...byModel.values()].sort((a, b) => b.count - a.count).slice(0, 20),
    users: [...byUser.values()].sort((a, b) => b.count - a.count).slice(0, 20),
    total: rows.length,
  };
}

export function auditList(input: { page: number; pageSize: number; query?: string; action?: string }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (input.query) {
    where.push("(username LIKE ? OR detail LIKE ? OR action LIKE ?)");
    const like = `%${input.query}%`;
    params.push(like, like, like);
  }
  if (input.action) {
    where.push("action LIKE ?");
    params.push(`${input.action}%`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const db = getDb();
  const total = (db.query(`SELECT COUNT(*) AS count FROM audit_logs ${clause}`).get(...params) as { count: number }).count;
  const rows = db.query(
    `SELECT id, user_id, username, action, target_type, target_id, detail, ip, created_at FROM audit_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, input.pageSize, (input.page - 1) * input.pageSize);
  return { total, page: input.page, pageSize: input.pageSize, items: rows };
}

export function dataUsage() {
  return directoryMetrics(dirname(conf.path));
}
