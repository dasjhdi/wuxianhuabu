// 本地模拟渠道服务：仅用于验证 dreammuse 渠道链路，不属于项目代码
const PORT = 8787;

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    console.log(`[mock] ${request.method} ${url.pathname}${url.search} token=${token || "-"}`);

    if (url.pathname === "/web/toonflow/user/getCaptcha") {
      return Response.json({ code: 200, message: "", data: { svg: "<svg>mock-captcha</svg>", captcha: "m0ck" } });
    }

    if (url.pathname === "/web/toonflow/user/login" && request.method === "POST") {
      return Response.json({ code: 200, message: "", data: { token: "mock-token-123", info: { userName: "mock", phone: "13800000000" } } });
    }

    if (url.pathname === "/web/web/model/getModelData") {
      if (!token) return Response.json({ code: 401, message: "未登录", data: null });
      return Response.json({ code: 200, message: "", data: [] });
    }

    return Response.json({ code: 404, message: "接口不存在", data: null });
  },
});

console.log(`[mock] 渠道服务已启动 http://127.0.0.1:${PORT}`);
