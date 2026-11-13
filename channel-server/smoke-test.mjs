// 渠道服务冒烟测试：鉴权 → 素材直传 → 插件提交 → 列表 → 收藏 → 更新 → 删除
const BASE = process.env.CHANNEL_BASE ?? "http://127.0.0.1:8787";

const call = async (path, { method = "GET", body, token, raw } = {}) => {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (raw) return { status: response.status, text };
  return { status: response.status, json: text ? JSON.parse(text) : null };
};

const step = (name, ok, detail = "") => console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);

// 1. 验证码与登录
const captcha = await call("/web/toonflow/user/getCaptcha");
const ticket = captcha.json.data.captcha;
const text = captcha.json.data.svg.match(/>([A-Z0-9]{4})</)[1];
const login = await call("/web/toonflow/user/login", {
  method: "POST", body: { userName: "demo", password: "demo123456", captcha: text, originalCaptcha: ticket },
});
step("登录", login.json.code === 200, login.json.data?.info?.userName);
const token = login.json.data.token;

// 2. 素材直传
const signature = await call("/web/web/plugIn/getUploadSignature", {
  method: "POST", token, body: { kind: "cover", fileName: "cover.png" },
});
step("获取上传签名", signature.json.code === 200, signature.json.data?.fileKey);
const { uploadUrl, fileKey, contentType } = signature.json.data;
const upload = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: Buffer.from("fake-png-bytes") });
step("PUT 直传素材", upload.ok, `HTTP ${upload.status}`);

// 3. 提交插件
const fileBase64 = `data:text/javascript;base64,${Buffer.from("export default { id: 'demoNode', label: '示例节点' };").toString("base64")}`;
const created = await call("/web/web/plugIn/uploadPlugin", {
  method: "POST", token,
  body: { name: "示例节点", identifier: "demoNode", type: "node", desc: "冒烟测试插件", fileBase64, fileName: "demoNode.umd.js", version: "1.0.0", coverKey: fileKey },
});
step("提交插件", created.json.code === 200, created.json.message);

// 4. 列表
const list = await call("/web/web/plugIn/getPlugIn", { method: "POST", token, body: { page: 1, limit: 10, type: "all" } });
const plugin = list.json.data?.list?.[0];
step("插件列表", list.json.code === 200 && list.json.data.total >= 1, `total=${list.json.data?.total} link=${plugin?.link}`);
step("列表自洽（state=1 必须有 link/fileName）", Boolean(plugin?.link && plugin?.fileName));

// 5. 存在性
const existence = await call("/web/web/plugIn/getPluginExistence", {
  method: "POST", token, body: { plugins: [{ type: "node", identifier: "demoNode" }, { type: "node", identifier: "missing" }] },
});
step("存在性查询", existence.json.data?.[0]?.exists === true && existence.json.data?.[1]?.exists === false);

// 6. 收藏
if (!plugin) {
  console.log("⏭ 跳过后续用例：插件未创建成功");
  process.exit(1);
}
const toggled = await call("/web/web/plugIn/toggleCollection", { method: "POST", token, body: { pluginId: plugin.id } });
step("切换收藏", toggled.json.data?.collected === true);
const collected = await call("/web/web/plugIn/getPlugIn", { method: "POST", token, body: { page: 1, limit: 10, type: "collection" } });
step("收藏列表", collected.json.data?.total === 1);

// 7. 素材可访问
const media = await fetch(`${BASE}/files/${fileKey}`);
step("素材可访问", media.ok, `HTTP ${media.status}`);

// 8. 越权保护
const noAuth = await call("/web/web/plugIn/getPlugIn", { method: "POST", body: { page: 1, limit: 10, type: "all" } });
step("未登录被拒绝", noAuth.status === 401, `HTTP ${noAuth.status} code=${noAuth.json?.code}`);

// 9. 更新
const updated = await call("/web/web/plugIn/updatePlugin", {
  method: "POST", token, body: { id: plugin.id, name: "示例节点", version: "1.0.1", fileBase64, fileName: "demoNode.umd.js" },
});
step("更新插件", updated.json.code === 200, updated.json.message);

// 10. 删除
const removed = await call("/web/web/plugIn/deletePlugin", { method: "POST", token, body: { id: plugin.id } });
const after = await call("/web/web/plugIn/getPlugIn", { method: "POST", token, body: { page: 1, limit: 10, type: "all" } });
step("删除插件", removed.json.code === 200 && after.json.data.total === 0, `剩余 ${after.json.data?.total}`);
