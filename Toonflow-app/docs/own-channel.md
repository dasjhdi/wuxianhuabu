# 自建官方统一渠道

创梦把模型账号、插件市场、余额与探索内容都收在「渠道」这一层抽象后面。默认实现指向官方服务，你也可以换成自己的后端，而不改动前端与业务路由。

## 🧭 架构位置

```
前端页面  →  /api/channel/*（本地业务路由，鉴权与参数校验）
              →  Channel 接口（apps/server/src/utils/channel/types.ts）
                 → 具体实现：toonflow（官方）/ dreammuse（自建）
                    → 你的后端服务
```

前端只与本地 `/api/channel/*` 通信，从不直接访问渠道地址。因此切换渠道对前端完全透明。

## 🚀 启用自建渠道

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `DREAMMUSE_CHANNEL` | 是 | 取值为 `dreammuse` 时启用自建渠道；缺省为 `toonflow` |
| `DREAMMUSE_API_BASE` | 是 | 你的渠道服务基址，如 `https://api.example.com`，结尾不要带斜杠 |

```sh
DREAMMUSE_CHANNEL=dreammuse bun run start:server
```

未配置 `DREAMMUSE_API_BASE` 时，渠道不会回落到官方服务器，而是在首次请求返回 `503` 与明确提示，避免数据被误发到非预期服务。

> 兼容：`TOONFLOW_CHANNEL` 仍可作为渠道选择的后备变量，便于沿用既有部署脚本。

## 📜 HTTP 契约

自建渠道与官方渠道共用同一套线协议，因此现有实现（`toonflow.ts`）可直接复用，只替换基址。

**请求**

- 鉴权：`Authorization: Bearer <token>`，token 由登录接口下发
- 内容：`Content-Type: application/json`，GET 参数走查询串
- 超时：常规 20 秒，插件与探索上传 60 秒

**响应信封**（缺一不可）

```json
{ "code": 200, "data": {}, "message": "" }
```

- `code` 必须为 `200`，其他值会被当作失败，`message` 会直接展示给用户
- 失败时使用 4xx/5xx 或非 200 的 `code`，二者皆可
- `message` 会被截断到 1000 字符，并自动脱敏密码、验证码等敏感字段

## 🔌 端点清单

共 37 个，全部以基址拼接。

### 用户与鉴权

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/web/toonflow/user/getCaptcha` | 图形验证码，返回 `{ svg, captcha }`；`captcha` 建议做成一次性票据，客户端会原样回传 |
| POST | `/web/toonflow/user/sendSmsCode` | 发送短信验证码 |
| POST | `/web/toonflow/user/register` | 注册，返回 `{ userCode }` |
| POST | `/web/toonflow/user/login` | 登录，返回 `{ token, info }` |
| POST | `/web/toonflow/user/forgotPassword` | 找回密码 |

### 账号与密钥

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/web/web/key/getKeyData` | 密钥列表（分页） |
| POST | `/web/web/key/addKey` | 新增密钥 |
| POST | `/web/web/key/delKey` | 删除密钥 |

### 钱包与充值

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/web/web/recharge/getRechargeData` | 余额概览 |
| GET | `/web/web/recharge/getPresentation` | 充值页展示配置 |
| GET | `/web/web/recharge/getActivity` | 充值活动 |
| GET | `/web/web/recharge/getBonusBatches` | 赠送批次（分页） |
| POST | `/web/web/recharge/exchange` | 兑换码兑换 |
| POST | `/web/web/recharge/pay` | 创建支付订单 |
| GET | `/web/web/recharge/queryOrder` | 查询支付状态 |
| GET | `/web/web/order/getOrder` | 订单列表（分页） |

### 用量与统计

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/web/web/operationLog/getOperationLog` | 操作流水（分页） |
| POST | `/web/web/query/getPointsConsumption` | 积分消耗统计 |
| GET | `/web/web/pointsPreview/getPreviewData` | 账号概览预览 |
| POST | `/web/web/pointsPreview/getUsageStatistics` | 用量统计 |

### 模型与供应商

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/web/web/model/getModelData?type=text\|image\|video\|audio` | 模型目录与计价 |
| GET | `/web/web/provider/getProviderSource` | 供应商 TS 源码，返回 `{ language, media }` |

### 插件市场

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/web/web/plugIn/getPlugIn` | 插件列表（分页、筛选） |
| POST | `/web/web/plugIn/getPluginExistence` | 批量查询是否已安装 |
| POST | `/web/web/plugIn/toggleCollection` | 收藏 / 取消收藏 |
| POST | `/web/web/plugIn/getUploadSignature` | 获取直传签名 |
| POST | `/web/web/plugIn/uploadPlugin` | 上传插件 |
| POST | `/web/web/plugIn/updatePlugin` | 更新插件 |
| POST | `/web/web/plugIn/deletePlugin` | 删除插件 |

### 探索社区

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/v1/explore/getProjects` | 探索列表 |
| POST | `/v1/explore/getProject` | 项目详情 |
| POST | `/v1/explore/getProcess` | 项目进度 |
| POST | `/v1/explore/getDownload` | 获取下载地址 |
| POST | `/web/toonflow/explore/getUploadSignature` | 作品上传签名 |
| POST | `/web/toonflow/explore/uploadProject` | 上传作品 |

### 运营内容

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/web/sponsor/getSponsorList` | 赞助者列表 |
| POST | `/web/toonflow/home/getAdvertisements` | 首页横幅与侧栏配置 |

## 🧱 最小实现示例

本机已有一份可运行的一期参考实现（FastAPI，含鉴权、凭证、模型目录、供应商下发与 OpenAI 兼容代理），位于仓库同级的 `channel-server/` 目录，运行方式见其 `README.md`。

Bun 原生写法，任意框架等价：

```ts
Bun.serve({
  port: 8787,
  async fetch(request) {
    const url = new URL(request.url);
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

    // 未鉴权接口
    if (url.pathname === "/web/toonflow/user/getCaptcha") {
      return Response.json({ code: 200, message: "", data: { svg: "<svg/>", captcha: "abcd" } });
    }

    // 需要鉴权的接口
    if (!token) return Response.json({ code: 401, message: "未登录", data: null });

    if (url.pathname === "/web/web/model/getModelData") {
      return Response.json({ code: 200, message: "", data: [] });
    }

    return Response.json({ code: 404, message: "接口不存在", data: null });
  },
});
```

## ✅ 联调校验

```sh
DREAMMUSE_CHANNEL=dreammuse DREAMMUSE_API_BASE=http://127.0.0.1:8787 bun run start:server
curl -s -H "Origin: http://localhost:3000" -H "x-toonflow-workspace: 1" \
  http://localhost:3000/api/channel/user/getCaptcha
```

返回体中的 `data.svg` 与 `data.captcha` 来自你的服务，即表示链路贯通。

## ⚠️ 实现注意

1. **响应信封必须严格**：`code` 为数字 `200`，`data` 字段即使为空也要存在（`null` 可接受）。
2. **`message` 面向最终用户**：会直接展示，避免暴露堆栈或内部标识。
3. **分页字段**：列表接口返回 `{ list, total }` 或对应的 `*Page` 结构，字段名需与 `types.ts` 一致。
4. **上传流程**：先取签名，客户端直传对象存储，再调用上传接口提交元数据；两段式不可省略。
5. **接口增减**：如你的后端路径不同，直接改 `dreammuse.ts` 中继承的方法即可，无需触碰路由层。
6. **模型调用要自己兜底鉴权**：供应商源码下发的 `apiUrl` 会直接暴露给客户端，模型代理端点必须自行校验令牌与余额，否则等于开放上游额度。
7. **用量以 `usage` 为准**：流式请求可要求上游返回 `stream_options.include_usage`，缺省时只能按 0 计费。
