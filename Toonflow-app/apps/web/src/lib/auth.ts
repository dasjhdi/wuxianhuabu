import axios from "axios";
import { computed, reactive } from "vue";

export type UserRole = "admin" | "member" | "viewer";

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  status: "active" | "disabled";
  createdAt: number;
  lastLoginAt: number | null;
  loginCount: number;
}

export interface SystemSettings {
  siteName: string;
  allowRegister: boolean;
  sessionDays: number;
  defaultRole: UserRole;
  registrationNotice: string;
}

interface AuthPayload {
  initialized: boolean;
  user: AuthUser | null;
  system: SystemSettings;
}

export const authState = reactive<{
  loaded: boolean;
  loading: boolean;
  initialized: boolean;
  user: AuthUser | null;
  system: SystemSettings;
}>({
  loaded: false,
  loading: false,
  initialized: false,
  user: null,
  system: { siteName: "创梦", allowRegister: false, sessionDays: 7, defaultRole: "member", registrationNotice: "请联系管理员开通账号" },
});

export const isAdmin = computed(() => authState.user?.role === "admin");
export const isAuthenticated = computed(() => authState.user !== null);

let pending: Promise<void> | null = null;

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1", ...(options.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => null)) as { code?: number; data?: T; message?: string } | null;
  if (!response.ok || payload?.code !== 200) {
    throw Object.assign(new Error(payload?.message || "请求失败，请稍后重试"), { status: response.status });
  }
  return payload.data as T;
}

export async function refreshAuth() {
  if (pending) return pending;
  authState.loading = true;
  pending = (async () => {
    try {
      const payload = await request<AuthPayload>("/api/auth/status");
      authState.initialized = payload.initialized;
      authState.user = payload.user;
      if (payload.system) authState.system = payload.system;
      authState.loaded = true;
    } finally {
      authState.loading = false;
      pending = null;
    }
  })();
  return pending;
}

export async function ensureAuth() {
  if (authState.loaded && authState.user) return;
  await refreshAuth();
}

export async function login(username: string, password: string, remember = false) {
  const user = await request<AuthUser>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, remember }),
  });
  authState.user = user;
  authState.initialized = true;
  authState.loaded = true;
  return user;
}

export async function setupAccount(input: { username: string; password: string; displayName?: string }) {
  const user = await request<AuthUser>("/api/auth/setup", { method: "POST", body: JSON.stringify(input) });
  authState.user = user;
  authState.initialized = true;
  authState.loaded = true;
  return user;
}

export async function registerAccount(input: { username: string; password: string; displayName?: string }) {
  const user = await request<AuthUser>("/api/auth/register", { method: "POST", body: JSON.stringify(input) });
  authState.user = user;
  authState.initialized = true;
  authState.loaded = true;
  return user;
}

export async function logout() {
  await request<null>("/api/auth/logout", { method: "POST" }).catch(() => null);
  authState.user = null;
  authState.loaded = true;
}

export function clearAuth() {
  authState.user = null;
  authState.loaded = false;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return request<null>("/api/auth/password", { method: "PUT", body: JSON.stringify({ currentPassword, newPassword }) });
}

export function goToLogin(reason?: string) {
  const current = `${location.hash.replace(/^#/, "") || "/home"}`;
  const query = current && !current.startsWith("/login") ? `?redirect=${encodeURIComponent(current)}` : "";
  location.hash = `#/login${query}${reason ? `${query ? "&" : "?"}reason=${encodeURIComponent(reason)}` : ""}`;
}

// ACT: 散落的 axios 直连也要在会话失效时回到登录页，避免页面停在半加载状态。
// 仅认证网关标记（x-toonflow-auth-expired）的 401 才代表本机会话失效；渠道等上游
// 服务透传的 401（如官方账号 token 在上游失效）由对应面板展示错误，不能误判成
// 登录失效把用户踢出当前页面——否则工作区里一打开设置弹窗就会被弹回首页。
axios.interceptors.response.use(undefined, (cause) => {
  const status = cause?.response?.status;
  const expired = cause?.response?.headers?.["x-toonflow-auth-expired"] === "1";
  if (status === 401 && expired) {
    clearAuth();
    if (!location.hash.startsWith("#/login")) goToLogin("登录状态已失效，请重新登录");
  }
  return Promise.reject(cause);
});
