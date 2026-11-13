# 创梦渠道服务 · 二期参考实现

自建官方统一渠道的后端。实现账号鉴权、凭证管理、模型目录、供应商下发、OpenAI 兼容代理、用量计量与钱包。

## 🔑 改密钥（唯一入口）

编辑 `channel-server/.env`：

```ini
CHANNEL_UPSTREAM_BASE=https://api.deepseek.com/v1
CHANNEL_UPSTREAM_KEY=sk-你的密钥
```

改完重启渠道服务即可，客户端无需任何改动。系统环境变量优先级高于 `.env`，可临时覆盖。

若不想经过渠道、直接在客户端接厂商：在应用「设置 → 语言模型」添加提供方（或改 `data/settings.json` 的 `settings.customProviders`），填 `apiUrl` / `apiKey` / `models` 三项。

> 注意：修改 `CHANNEL_TOKEN_SECRET` 会使已签发的登录令牌全部失效，用户需重新登录并在「账号与余额」刷新一次供应商。

## 🚀 启动

```sh
pip install fastapi "uvicorn[standard]" httpx
cd channel-server
python -m uvicorn main:app --host 127.0.0.1 --port 8787
```

`.env` 会被自动读取，无需再设置环境变量。

客户端侧：

```sh
DREAMMUSE_CHANNEL=dreammuse \
DREAMMUSE_API_BASE=http://127.0.0.1:8787 \
bun run dev
```

## ⚙️ 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `CHANNEL_PUBLIC_BASE` | `http://127.0.0.1:8787` | 写入供应商源码的 `apiUrl`，必须是**客户端可访问**的地址 |
| `CHANNEL_UPSTREAM_BASE` | 空 | 真实模型上游（OpenAI 兼容）；为空时模型调用返回 503 |
| `CHANNEL_UPSTREAM_KEY` | 空 | 上游密钥，仅保存在服务端 |
| `CHANNEL_SMS_WEBHOOK` | 空 | 短信网关地址；为空时验证码只打印到日志 |
| `CHANNEL_INITIAL_BALANCE` | `10` | 新注册用户的试用余额（元） |
| `CHANNEL_INPUT_PRICE` | `0.002` | 输入计价（元 / 1K tokens），按你的上游实际价格调整 |
| `CHANNEL_OUTPUT_PRICE` | `0.008` | 输出计价（元 / 1K tokens） |
| `CHANNEL_TOKEN_SECRET` | `dev-secret-change-me` | 令牌签名密钥，**上线前必须更换** |

## 🧩 模型目录

启动时从上游 `/v1/models` 动态拉取（`refresh_models()`），换厂商只需改 `.env`，不必动代码；拉取失败时回落到内置兜底模型。

改动目录后，客户端需要在「设置 → 账号与余额」点一次刷新，让账号供应商重新下发模型列表。

## 🔐 二期加固内容

| 项 | 一期问题 | 二期做法 |
| --- | --- | --- |
| 图形验证码 | 文本随响应下发，校验形同虚设 | 文本只存服务端，下发一次性票据；5 分钟过期，无论对错均作废 |
| 短信验证码 | 固定码 `123456` | 6 位随机码，5 分钟过期、一次性、同号码 60 秒冷却；可接短信网关 |
| 模型代理 | 无鉴权、无计量，任何人可白用上游额度 | 必须携带登录令牌或 `sk-cm-` 凭证；余额不足返回 402；按 token 计费并落库 |
| 钱包 | 空数据桩 | 套餐、订单、余额、消费流水、用量统计均由真实数据计算 |

## 📊 计量规则

- 计费依据上游返回的 `usage`；流式请求会自动追加 `stream_options.include_usage=true`。
- 单价取自 `CHANNEL_INPUT_PRICE` / `CHANNEL_OUTPUT_PRICE`（每 1K tokens），对所有模型统一。
- 每次调用写入 `usage_records` 并扣减余额；余额 ≤ 0 时拒绝请求。
- 客户端中断的流式请求可能收不到 `usage`，此类调用按 0 计费。

## ✅ 已实现端点

鉴权 5 个、凭证 3 个、模型目录 1 个、供应商源码 1 个、钱包与统计 9 个、插件市场 8 个（列表、存在性、收藏、上传签名、提交、更新、删除、素材直传与读取），以及 `/v1/chat/completions`、`/v1/models`。

仍为空数据桩：探索社区 6 个、赞助与首页广告 2 个。

## 📦 插件市场

上传是三段式，与客户端实现一致：

1. `POST /web/web/plugIn/getUploadSignature` 取签名，返回 `{ uploadUrl, fileKey, contentType }`；
2. `PUT uploadUrl` 直传素材（封面 / 演示视频），落盘到 `storage/media/`；
3. `POST /web/web/plugIn/uploadPlugin` 提交元数据与插件包（`fileBase64` 按客户端约定是 data URI）。

约束与行为：

- 插件包只接受 `.js` 与 `.zip`，同类型同标识同作者重复提交会被拒绝并提示改用更新。
- `state` 固定为 1（已上架）；列表项必须带 `link` 与 `fileName`，否则客户端会判定列表格式错误。
- `type` 支持 `all` / 具体类型 / `my` / `collection`；`searchKeyword` 匹配名称与标识。
- 删除与更新校验归属，非作者返回 404；删除会同时清理收藏关系。
- 素材通过 `GET /files/{key}` 读取，路径做了目录穿越校验。

## 🔁 重置数据

删除 `channel.db` 与 `storage/` 后重启会重建表并清空账号、凭证、订单、消费记录与插件文件。

## 🧪 冒烟测试

```sh
bun run smoke-test.mjs
```

覆盖登录、素材直传、插件提交、列表结构自洽、存在性、收藏、素材可读、未登录拒绝、更新与删除，共 13 项断言。

## ⚠️ 上线前仍需处理

1. **令牌不可吊销**：HMAC 载荷仅在过期时失效，改密码不会踢掉旧会话；建议引入刷新令牌与黑名单。
2. **支付未接入**：`recharge/pay` 明确返回未接入提示，不会伪造支付成功。
3. **用量以事件为准**：上游未返回 `usage` 时按 0 计费，需在上游侧开启用量返回，或改为本地 tokenizer 估算。
4. **并发与事务**：SQLite 单机写入，多实例部署需换 PostgreSQL 并把扣费放进事务。
5. **存储为本地磁盘**：`storage/` 适合单机验证，生产应换对象存储并对直传做签名与限流。
6. **无对账机制**：余额与上游账单需定期人工核对，后续应加日终对账任务。

