import { Database } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { error } from "@/lib/responseFormat";

export type UserRole = "admin" | "member" | "viewer";
export type UserStatus = "active" | "disabled";

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
  loginCount: number;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
  login_count: number;
}

export const SESSION_COOKIE = "toonflow_session";
const PUBLIC_PREFIXES = ["/auth/", "/desktop/", "/mobileLink/", "/channel/"];
const SECRET_FIELD = /^(?:apiKey|token|secret|password|accessKey|secretKey|appSecret)$/i;
const LOGIN_WINDOW = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

let database: Database | null = null;
const loginFailures = new Map<string, { count: number; resetAt: number }>();
let lastSeenFlush = new Map<number, number>();

export function getDb() {
  if (database) return database;
  const dataDirectory = process.env.TOONFLOW_DATA_DIR || resolve(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true });
  const db = new Database(resolve(dataDirectory, "system.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER,
      login_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      kind TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      path TEXT,
      status INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at DESC);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  database = db;
  return db;
}

export function publicUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    loginCount: row.login_count,
  };
}

export function countUsers() {
  return (getDb().query("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
}

export function listUsers() {
  return getDb().query("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
}

export function findUserByUsername(username: string) {
  return getDb().query("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as UserRow | null;
}

export function findUserById(id: number) {
  return getDb().query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
}

export function validatePasswordStrength(password: string) {
  if (password.length < 8) return "密码至少需要 8 位字符";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "密码需要同时包含字母和数字";
  return null;
}

export async function hashPassword(password: string) {
  return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
}

export async function verifyPassword(password: string, hash: string) {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

export async function createUser(input: { username: string; password: string; displayName?: string; role?: UserRole }) {
  const username = input.username.trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw Object.assign(new Error("用户名需为 3-32 位字母、数字或 _ . -"), { status: 400 });
  const passwordError = validatePasswordStrength(input.password);
  if (passwordError) throw Object.assign(new Error(passwordError), { status: 400 });
  if (findUserByUsername(username)) throw Object.assign(new Error("该用户名已存在"), { status: 409 });
  const now = Date.now();
  const passwordHash = await hashPassword(input.password);
  const result = getDb().run(
    "INSERT INTO users (username, display_name, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
    [username, (input.displayName ?? "").trim() || username, passwordHash, input.role ?? "member", now, now],
  );
  return findUserById(Number(result.lastInsertRowid))!;
}

export async function updateUserPassword(userId: number, password: string) {
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw Object.assign(new Error(passwordError), { status: 400 });
  const passwordHash = await hashPassword(password);
  getDb().run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [passwordHash, Date.now(), userId]);
}

export function updateUser(userId: number, patch: { displayName?: string; role?: UserRole; status?: UserStatus }) {
  const current = findUserById(userId);
  if (!current) throw Object.assign(new Error("用户不存在"), { status: 404 });
  const nextRole = patch.role ?? current.role;
  const nextStatus = patch.status ?? current.status;
  if (current.role === "admin" && (nextRole !== "admin" || nextStatus !== "active")) {
    const admins = getDb().query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get() as { count: number };
    if (admins.count <= 1) throw Object.assign(new Error("必须保留至少一个启用状态的管理员"), { status: 400 });
  }
  getDb().run("UPDATE users SET display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?", [
    patch.displayName !== undefined ? patch.displayName.trim() || current.username : current.display_name,
    nextRole,
    nextStatus,
    Date.now(),
    userId,
  ]);
  return findUserById(userId)!;
}

export function deleteUser(userId: number) {
  const current = findUserById(userId);
  if (!current) throw Object.assign(new Error("用户不存在"), { status: 404 });
  if (current.role === "admin") {
    const admins = getDb().query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get() as { count: number };
    if (admins.count <= 1) throw Object.assign(new Error("必须保留至少一个启用状态的管理员"), { status: 400 });
  }
  getDb().run("DELETE FROM users WHERE id = ?", [userId]);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function requestIp(request: Request) {
  const forwarded = request.headers["x-forwarded-for"];
  const raw = typeof forwarded === "string" && forwarded ? forwarded.split(",")[0].trim() : request.ip ?? request.socket.remoteAddress ?? "";
  return raw.replace(/^::ffff:/, "");
}

export function setSessionCookie(response: Response, value: string, maxAge: number) {
  response.append("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}`);
}

export function clearSessionCookie(response: Response) {
  response.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function createSession(userId: number, request: Request, response: Response, remember = false) {
  const sessionId = randomBytes(12).toString("hex");
  const token = randomBytes(32).toString("hex");
  const configuredDays = Math.min(30, Math.max(1, Number(getMeta("sessionDays", 7)) || 7));
  const maxAge = (remember ? Math.max(configuredDays, 30) : configuredDays) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  getDb().run(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [sessionId, userId, hashToken(token), now, now + maxAge, now, requestIp(request), (request.headers["user-agent"] ?? "").slice(0, 300)],
  );
  getDb().run("UPDATE users SET last_login_at = ?, login_count = login_count + 1 WHERE id = ?", [now, userId]);
  setSessionCookie(response, `${sessionId}.${token}`, maxAge);
  return maxAge;
}

export function destroySession(request: Request, response: Response) {
  const raw = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (raw) {
    const [sessionId] = raw.split(".");
    if (sessionId) getDb().run("DELETE FROM sessions WHERE id = ?", [sessionId]);
  }
  clearSessionCookie(response);
}

export function resolveSession(request: Request): SessionUser | null {
  const raw = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!raw) return null;
  const [sessionId, token] = raw.split(".");
  if (!sessionId || !token) return null;
  const row = getDb().query(
    `SELECT s.id AS session_id, s.token_hash, s.expires_at, u.*
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  ).get(sessionId) as (UserRow & { session_id: string; token_hash: string; expires_at: number }) | null;
  if (!row || row.expires_at < Date.now()) {
    if (row) getDb().run("DELETE FROM sessions WHERE id = ?", [sessionId]);
    return null;
  }
  const expected = Buffer.from(row.token_hash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (row.status !== "active") return null;
  const now = Date.now();
  if (now - (lastSeenFlush.get(row.id) ?? 0) > 5 * 60 * 1000) {
    lastSeenFlush.set(row.id, now);
    getDb().run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [now, sessionId]);
  }
  return publicUser(row);
}

export function currentUser(request: Request) {
  return (request as Request & { sessionUser?: SessionUser }).sessionUser ?? null;
}

export function isPublicApiPath(path: string) {
  return PUBLIC_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function authGate(request: Request, response: Response, next: NextFunction) {
  const path = request.originalUrl.replace(/^\/api/, "").split("?")[0];
  if (isPublicApiPath(path)) return next();
  // ACT: 已配对设备经 mobileLink 网关校验令牌后访问，等同成员权限；后台仍要求管理员 Cookie。
  const deviceId = (response.locals as { toonflowDeviceId?: unknown }).toonflowDeviceId;
  if (deviceId) {
    if (path.startsWith("/admin/")) return response.status(403).json(error("需要管理员权限", null, 403));
    return next();
  }
  const user = resolveSession(request);
  // ACT: 带 x-toonflow-auth-expired 标记的是本机会话失效；前端拦截器只据此登出。
  // 渠道等上游服务透传的 401（如官方账号在 api.toonflow.net 失效）不带标记，
  // 由对应面板展示错误，避免用户被误踢回首页。
  if (!user) return response.status(401).header("x-toonflow-auth-expired", "1").json(error("请先登录后再操作", null, 401));
  (request as Request & { sessionUser?: SessionUser }).sessionUser = user;
  if (path.startsWith("/admin/") && user.role !== "admin") return response.status(403).json(error("需要管理员权限", null, 403));
  next();
}

export function requireAdmin(request: Request) {
  const user = currentUser(request);
  if (!user) throw Object.assign(new Error("请先登录后再操作"), { status: 401 });
  if (user.role !== "admin") throw Object.assign(new Error("需要管理员权限"), { status: 403 });
  return user;
}

export function loginAllowed(key: string) {
  const entry = loginFailures.get(key);
  if (!entry) return true;
  if (entry.resetAt < Date.now()) {
    loginFailures.delete(key);
    return true;
  }
  return entry.count < LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(key: string) {
  const entry = loginFailures.get(key);
  const now = Date.now();
  if (!entry || entry.resetAt < now) loginFailures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW });
  else entry.count += 1;
}

export function clearLoginFailures(key: string) {
  loginFailures.delete(key);
}

export function recordAudit(input: {
  userId?: number | null;
  username?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | number;
  detail?: string;
  ip?: string;
}) {
  getDb().run(
    "INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [input.userId ?? null, input.username ?? null, input.action, input.targetType ?? null, input.targetId === undefined ? null : String(input.targetId), input.detail ?? null, input.ip ?? null, Date.now()],
  );
}

export function recordUsage(input: {
  userId?: number | null;
  username?: string | null;
  kind: string;
  model?: string | null;
  provider?: string | null;
  path: string;
  status: number;
  durationMs: number;
}) {
  getDb().run(
    "INSERT INTO usage_records (user_id, username, kind, model, provider, path, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [input.userId ?? null, input.username ?? null, input.kind, input.model ?? null, input.provider ?? null, input.path, input.status, Math.round(input.durationMs), Date.now()],
  );
}

export function usageRecorder(request: Request, response: Response, next: NextFunction) {
  const path = request.originalUrl.split("?")[0];
  if (path !== "/api/ai/media/generate" && path !== "/api/ai/generate") return next();
  const startedAt = Date.now();
  response.on("finish", () => {
    try {
      const user = currentUser(request);
      const body = (request.body ?? {}) as { model?: unknown; modelId?: unknown; mediaType?: unknown };
      const mediaType = typeof body.mediaType === "string" ? body.mediaType : null;
      const kind = mediaType === "video" || mediaType === "audio" || mediaType === "image" ? mediaType : "text";
      const model = typeof body.model === "string" ? body.model : typeof body.modelId === "string" ? body.modelId : null;
      recordUsage({
        userId: user?.id,
        username: user?.username,
        kind,
        model: model?.slice(0, 120) ?? null,
        provider: null,
        path,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    } catch (cause) {
      console.error("记录用量失败：", cause);
    }
  });
  next();
}

export function getMeta<T>(key: string, fallback: T): T {
  const row = getDb().query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setMeta(key: string, value: unknown) {
  getDb().run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]);
}

export function getSystemSettings() {
  return {
    siteName: getMeta("siteName", "创梦"),
    allowRegister: getMeta("allowRegister", false),
    sessionDays: getMeta("sessionDays", 7),
    defaultRole: getMeta<UserRole>("defaultRole", "member"),
    registrationNotice: getMeta("registrationNotice", "请联系管理员开通账号"),
  };
}

export function saveSystemSettings(patch: Record<string, unknown>) {
  const next = { ...getSystemSettings() };
  if (typeof patch.siteName === "string" && patch.siteName.trim()) next.siteName = patch.siteName.trim().slice(0, 40);
  if (typeof patch.allowRegister === "boolean") next.allowRegister = patch.allowRegister;
  if (typeof patch.sessionDays === "number") next.sessionDays = Math.min(30, Math.max(1, Math.round(patch.sessionDays)));
  if (patch.defaultRole === "admin" || patch.defaultRole === "member" || patch.defaultRole === "viewer") next.defaultRole = patch.defaultRole;
  if (typeof patch.registrationNotice === "string") next.registrationNotice = patch.registrationNotice.slice(0, 200);
  for (const [key, value] of Object.entries(next)) setMeta(key, value);
  return next;
}

export function dataDirectory() {
  return dirname(resolve(process.env.TOONFLOW_DATA_DIR || resolve(process.cwd(), "data"), "system.db"));
}

// ACT: 只读角色仍需要主题与模型列表渲染画布，但不应拿到供应商密钥。
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => redactSecrets(item)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_FIELD.test(key) ? "" : redactSecrets(item);
    }
    return output as T;
  }
  return value;
}
