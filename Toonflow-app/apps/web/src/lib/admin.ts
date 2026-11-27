import http from "@/lib/http";

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "member" | "viewer";
  status: "active" | "disabled";
  createdAt: number;
  lastLoginAt: number | null;
  loginCount: number;
}

export interface TrendDay {
  date: string;
  image: number;
  video: number;
  audio: number;
  text: number;
  total: number;
  failed: number;
}

export interface OverviewData {
  users: { total: number; active: number; admins: number };
  projects: { total: number; canvases: number; assets: number };
  storage: { bytes: number; files: number };
  usage: { today: number; todaySuccess: number; auditToday: number; trend: TrendDay[] };
  recent: AuditItem[];
  topProjects: ProjectItem[];
}

export interface ProjectItem {
  name: string;
  canvasCount: number;
  assetCount: number;
  size: number;
  updatedAt: number;
}

export interface UsageData {
  days: TrendDay[];
  models: { model: string; kind: string; count: number; failed: number; totalMs: number }[];
  users: { username: string; count: number; failed: number }[];
  total: number;
}

export interface AuditItem {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
  created_at: number;
}

export interface AuditPage {
  total: number;
  page: number;
  pageSize: number;
  items: AuditItem[];
}

export interface AdminSettings {
  system: {
    siteName: string;
    allowRegister: boolean;
    sessionDays: number;
    defaultRole: "admin" | "member" | "viewer";
    registrationNotice: string;
  };
  providers: { id: string; name: string; models: number; configured: boolean; kind: "custom" | "media" | "account" }[];
  runtime: {
    version: string;
    platform: string;
    arch: string;
    bun: string;
    dataDirectory: string;
    storageBytes: number;
    storageFiles: number;
  };
}

export const adminApi = {
  overview: () => http<OverviewData>({ url: "/api/admin/overview", method: "GET" }),
  users: (params?: { q?: string; role?: string }) => http<{ total: number; items: AdminUser[] }>({ url: "/api/admin/users", method: "GET", params }),
  createUser: (data: { username: string; password: string; displayName?: string; role?: string }) => http<AdminUser>({ url: "/api/admin/users/create", method: "POST", data }),
  updateUser: (data: { id: number; displayName?: string; role?: string; status?: string }) => http<AdminUser>({ url: "/api/admin/users/update", method: "POST", data }),
  deleteUser: (id: number) => http<null>({ url: "/api/admin/users/delete", method: "POST", data: { id } }),
  resetPassword: (id: number, password: string) => http<null>({ url: "/api/admin/users/resetPassword", method: "POST", data: { id, password } }),
  projects: () => http<{ total: number; totalSize: number; items: ProjectItem[] }>({ url: "/api/admin/projects", method: "GET" }),
  deleteProject: (name: string) => http<{ movedTo: string }>({ url: "/api/admin/projects/delete", method: "POST", data: { name } }),
  usage: (days: number) => http<UsageData>({ url: "/api/admin/usage", method: "GET", params: { days } }),
  audit: (params: { page: number; pageSize: number; q?: string; action?: string }) => http<AuditPage>({ url: "/api/admin/audit", method: "GET", params }),
  settings: () => http<AdminSettings>({ url: "/api/admin/settings", method: "GET" }),
  saveSettings: (data: Record<string, unknown>) => http<AdminSettings["system"]>({ url: "/api/admin/settings/save", method: "PUT", data }),
};

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDateTime(value: number | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function relativeTime(value: number | null | undefined) {
  if (!value) return "从未登录";
  const diff = Date.now() - value;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDateTime(value);
}

export const actionLabels: Record<string, string> = {
  "login.success": "登录成功",
  "login.failed": "登录失败",
  "login.disabled": "禁用账号尝试登录",
  logout: "退出登录",
  "system.setup": "系统初始化",
  "user.create": "创建账号",
  "user.update": "修改账号",
  "user.delete": "删除账号",
  "user.resetPassword": "重置密码",
  "password.change": "修改密码",
  "project.delete": "删除项目",
  "settings.save": "修改系统设置",
};

export const roleLabels: Record<string, string> = { admin: "管理员", member: "成员", viewer: "只读" };
