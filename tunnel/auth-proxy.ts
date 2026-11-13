/**
 * 创梦 · 公网访问鉴权反代
 *
 * 作用：cloudflared 隧道 → 本代理(8090) → 本机应用(3000)
 * 鉴权：口令换取 HttpOnly Cookie，未通过则跳转登录页；API 请求返回 401 JSON。
 *
 * 环境变量：
 *   DREAMMUSE_ACCESS_PASSWORD  必填，访问口令
 *   AUTH_PROXY_PORT            可选，默认 8090
 *   AUTH_UPSTREAM              可选，默认 http://127.0.0.1:3000
 */

const PASSWORD = process.env.DREAMMUSE_ACCESS_PASSWORD ?? "";
const PORT = Number(process.env.AUTH_PROXY_PORT ?? 8090);
const UPSTREAM = process.env.AUTH_UPSTREAM ?? "http://127.0.0.1:3000";
const COOKIE = "dm_session";
const MAX_AGE = 7 * 24 * 3600;

if (!PASSWORD) {
  console.error("缺少 DREAMMUSE_ACCESS_PASSWORD，拒绝启动");
  process.exit(1);
}

const encoder = new TextEncoder();

async function sign(value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Buffer.from(signature).toString("base64url");
}

async function issueToken() {
  const expires = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return `${expires}.${await sign(expires)}`;
}

async function verifyToken(token: string | undefined) {
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = await sign(expires);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return diff === 0;
}

function cookieValue(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return undefined;
}

// 简易防爆破：同一来源 10 分钟内最多 8 次失败
const failures = new Map<string, { count: number; resetAt: number }>();
function tooManyFailures(ip: string) {
  const record = failures.get(ip);
  if (!record || record.resetAt < Date.now()) return false;
  return record.count >= 8;
}
function recordFailure(ip: string) {
  const now = Date.now();
  const record = failures.get(ip);
  if (!record || record.resetAt < now) failures.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
  else record.count += 1;
}

const loginPage = (message = "") => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>创梦 · 访问验证</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#0f1115;color:#e6e8ee;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}
  form{width:320px;padding:28px;border:1px solid #262b36;border-radius:14px;background:#161a22}
  h1{margin:0 0 6px;font-size:18px}p{margin:0 0 18px;color:#8b94a7;font-size:13px}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #303747;background:#0f131a;color:#e6e8ee;outline:none}
  button{margin-top:14px;width:100%;padding:10px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-size:14px;cursor:pointer}
  .err{margin-top:12px;color:#f87171;font-size:13px}
</style></head>
<body><form method="post" action="/__login">
  <h1>创梦</h1><p>请输入访问口令</p>
  <input type="password" name="password" autofocus autocomplete="current-password" placeholder="访问口令" />
  <button type="submit">进入</button>
  ${message ? `<div class="err">${message}</div>` : ""}
</form></body></html>`;

function wantsHtml(request: Request) {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/** 外部协议由隧道头决定，避免 https 页面被重定向到 http。 */
function externalOrigin(request: Request, url: URL) {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return `${proto}://${url.host}`;
}

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(request, server) {
    const url = new URL(request.url);
    const ip = server.requestIP(request)?.address ?? "unknown";

    if (url.pathname === "/__login") {
      if (request.method === "GET") return new Response(loginPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
      if (request.method === "POST") {
        if (tooManyFailures(ip)) return new Response(loginPage("尝试次数过多，请 10 分钟后再试"), { status: 429, headers: { "content-type": "text/html; charset=utf-8" } });
        const form = await request.formData();
        if (String(form.get("password") ?? "") !== PASSWORD) {
          recordFailure(ip);
          return new Response(loginPage("口令不正确"), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
        }
        failures.delete(ip);
        const token = await issueToken();
        return new Response(null, {
          status: 302,
          headers: { location: url.searchParams.get("next") ?? "/", "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}; Secure` },
        });
      }
    }

    if (url.pathname === "/__logout") {
      return new Response(null, { status: 302, headers: { location: "/__login", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Max-Age=0` } });
    }

    if (!(await verifyToken(cookieValue(request)))) {
      if (wantsHtml(request)) {
        const next = encodeURIComponent(url.pathname + url.search);
        return Response.redirect(`${externalOrigin(request, url)}/__login?next=${next}`, 302);
      }
      return new Response(JSON.stringify({ code: 401, message: "请先通过访问验证" }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    const target = new URL(url.pathname + url.search, UPSTREAM);
    const headers = new Headers(request.headers);
    // ACT: 保留外部 Host，服务端 Origin/Host 来源校验才一致；同时访客仍受工作区白名单约束。
    headers.set("host", url.host);
    headers.delete("cookie");
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });
      const responseHeaders = new Headers(upstream.headers);
      // ACT: fetch 已解压响应体，剔除编码与长度头避免内容错位。
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      return new Response(`上游不可达：${error instanceof Error ? error.message : String(error)}`, { status: 502 });
    }
  },
});

console.log(`[auth-proxy] 监听 http://127.0.0.1:${PORT} → ${UPSTREAM}`);
