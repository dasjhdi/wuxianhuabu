"""创梦自建渠道 · 二期后端

一期：账号鉴权、凭证、模型目录、供应商下发、OpenAI 兼容代理
二期：验证码服务端状态、随机短信码与发送通道、代理鉴权与计量、钱包与消费记录

运行：uvicorn main:app --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import random
import re
import secrets
import sqlite3
import string
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

DB_PATH = os.path.join(os.path.dirname(__file__), "channel.db")


def load_dotenv(path: str) -> None:
    """读取同目录 .env；已存在的环境变量优先，便于临时覆盖。"""
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

TOKEN_SECRET = os.environ.get("CHANNEL_TOKEN_SECRET", "dev-secret-change-me")
TOKEN_TTL = 7 * 24 * 3600
PUBLIC_BASE = os.environ.get("CHANNEL_PUBLIC_BASE", "http://127.0.0.1:8787")
UPSTREAM_BASE = os.environ.get("CHANNEL_UPSTREAM_BASE", "").rstrip("/")
# 上游可能填裸域名或带 /v1 的地址，统一归一到 OpenAI 兼容根路径。
UPSTREAM_V1 = UPSTREAM_BASE if UPSTREAM_BASE.endswith("/v1") else (f"{UPSTREAM_BASE}/v1" if UPSTREAM_BASE else "")
UPSTREAM_KEY = os.environ.get("CHANNEL_UPSTREAM_KEY", "")
SMS_WEBHOOK = os.environ.get("CHANNEL_SMS_WEBHOOK", "")
INITIAL_BALANCE = float(os.environ.get("CHANNEL_INITIAL_BALANCE", "10"))

# ── 图片代理 ────────────────────────────────────────────────
# 图片默认复用视频所用同一把上游 Key；需要独立图片服务时用 CHANNEL_IMAGE_* 覆盖。
IMAGE_UPSTREAM_BASE = os.environ.get("CHANNEL_IMAGE_UPSTREAM_BASE", UPSTREAM_BASE).rstrip("/")
IMAGE_UPSTREAM_V1 = IMAGE_UPSTREAM_BASE if IMAGE_UPSTREAM_BASE.endswith("/v1") else (
    f"{IMAGE_UPSTREAM_BASE}/v1" if IMAGE_UPSTREAM_BASE else "")
IMAGE_UPSTREAM_KEY = os.environ.get("CHANNEL_IMAGE_UPSTREAM_KEY", UPSTREAM_KEY)
# 上游 /v1/models 不含图片模型，图片模型单独声明，避免被目录刷新覆盖。
# 名单取自坤柔文档「OpenAI 协议生图」：示例模型 gpt-image-2，Grok 图片模型走同一对接口。
IMAGE_MODELS = tuple(
    name.strip() for name in os.environ.get(
        "CHANNEL_IMAGE_MODELS",
        "gpt-image-2,grok-imagine-image",
    ).split(",") if name.strip()
)
IMAGE_PRICE = float(os.environ.get("CHANNEL_IMAGE_PRICE", "0.2"))
IMAGE_DEFAULT_SIZE = os.environ.get("CHANNEL_IMAGE_DEFAULT_SIZE", "1024x1024")
IMAGE_MAX_COUNT = int(os.environ.get("CHANNEL_IMAGE_MAX_COUNT", "4"))
# 上游按「宽x高」接收尺寸（坤柔文档示例 1024x1536），渠道负责把 * 与宽高比换算成该格式。
IMAGE_RATIO_SIZES = {
    "1:1": "1024x1024",
    "4:3": "1152x864",
    "3:4": "864x1152",
    "16:9": "1280x720",
    "9:16": "720x1280",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
}

# ── Gemini 原生协议图片 ─────────────────────────────────────
# 坤柔的 gemini 图片模型不支持 OpenAI 生图接口，只支持
# POST /v1beta/models/{model}:generateContent，且通常绑定独立 Key。
GEMINI_UPSTREAM_BASE = os.environ.get("CHANNEL_GEMINI_UPSTREAM_BASE", IMAGE_UPSTREAM_BASE).rstrip("/")
GEMINI_UPSTREAM_KEY = os.environ.get("CHANNEL_GEMINI_UPSTREAM_KEY", "")
GEMINI_MODELS = tuple(
    name.strip() for name in os.environ.get(
        "CHANNEL_GEMINI_MODELS",
        "gemini-3-pro-image-preview,gemini-3-pro-image,gemini-3.1-flash-image-preview,gemini-3.1-flash-image,gemini-nano-banana-2.1",
    ).split(",") if name.strip()
)
GEMINI_MODEL_SET = frozenset(GEMINI_MODELS)
GEMINI_IMAGE_PRICE = float(os.environ.get("CHANNEL_GEMINI_IMAGE_PRICE", os.environ.get("CHANNEL_IMAGE_PRICE", "0.2")))
# 文档给出的画质档位；模型不支持时由上游返回错误。
GEMINI_SIZE_TOKENS = ("512", "1K", "2K", "4K")

# 面向用户的显示名：上游模型 ID 保持原样，画布里用易读名称，避免"香蕉"模型找不到。
MODEL_LABELS = {
    "gpt-image-2": "GPT Image 2",
    "gpt-image-2.5": "GPT Image 2.5",
    "gpt-image-2.5-flare": "GPT Image 2.5 Flare",
    "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
    "gpt-image-2.6": "GPT Image 2.6",
    "gpt-image-2.6-flare": "GPT Image 2.6 Flare",
    "gpt-image-2.6-sunburst": "GPT Image 2.6 Sunburst",
    "gemini-3-pro-image-preview": "Nano Banana Pro（预览）",
    "gemini-3-pro-image": "Nano Banana Pro",
    "gemini-3.1-flash-image-preview": "Nano Banana 2（预览）",
    "gemini-3.1-flash-image": "Nano Banana 2",
    "gemini-nano-banana-2.1": "Nano Banana 2.1",
}

CAPTCHA_TTL = 300
SMS_TTL = 300
SMS_COOLDOWN = 60

app = FastAPI(title="创梦渠道服务", version="0.2.0")

_captchas: dict[str, tuple[str, float]] = {}
_sms_codes: dict[str, tuple[str, float, float]] = {}

DEFAULT_INPUT_PRICE = float(os.environ.get("CHANNEL_INPUT_PRICE", "0.002"))
DEFAULT_OUTPUT_PRICE = float(os.environ.get("CHANNEL_OUTPUT_PRICE", "0.008"))

# 上游不可达时的兜底目录；正常情况会被 refresh_models() 覆盖
MODELS = [
    {"id": 1, "code_name": "deepseek-chat", "type": "text", "ability": "通用对话", "quality": "标准",
     "input_price": DEFAULT_INPUT_PRICE, "output_price": DEFAULT_OUTPUT_PRICE, "illustrate": "兜底模型"},
]
PRICING = {model["code_name"]: model for model in MODELS}

# 上游 /v1/models 不返回模态信息，按名称推断，避免视频/语音模型混进语言模型列表。
MODEL_TYPE_HINTS = {
    "video": ("video", "imagine", "veo", "sora", "kling", "seedance", "omni", "sd2.", "sd1.", "sd-1", "sd-2"),
    "audio": ("tts", "voice", "audio", "lyria", "suno", "music", "speech"),
    "image": ("image", "dall", "flux", "seedream", "midjourney"),
}


def classify_model(name: str) -> str:
    lowered = name.lower()
    for kind, hints in MODEL_TYPE_HINTS.items():
        if any(hint in lowered for hint in hints):
            return kind
    return "text"


def catalog_with_images(models: list[dict]) -> list[dict]:
    """把声明的图片模型并入目录；图片模型按张计价，不走 token 计价。"""
    combined = list(models)
    names = {model["code_name"] for model in combined}
    for name in IMAGE_MODELS:
        if name in names:
            continue
        combined.append({
            "id": 0, "code_name": name, "type": "image", "ability": "AI 绘图", "quality": "标准",
            "input_price": DEFAULT_INPUT_PRICE, "output_price": DEFAULT_OUTPUT_PRICE,
            "unit_price": IMAGE_PRICE, "protocol": "openai", "illustrate": f"{name}（渠道图片代理）",
        })
        names.add(name)
    for name in GEMINI_MODELS:
        if name in names:
            continue
        combined.append({
            "id": 0, "code_name": name, "type": "image", "ability": "AI 绘图（Gemini）", "quality": "标准",
            "input_price": DEFAULT_INPUT_PRICE, "output_price": DEFAULT_OUTPUT_PRICE,
            "unit_price": GEMINI_IMAGE_PRICE, "protocol": "gemini", "illustrate": f"{name}（渠道图片代理）",
        })
        names.add(name)
    # ACT: 重新编号，避免追加图片模型后出现重复 ID。
    for index, model in enumerate(combined, start=1):
        model["id"] = index
    return combined


def refresh_models() -> None:
    """从上游 /v1/models 拉取模型目录；失败时保留兜底列表。"""
    global MODELS, PRICING
    if not UPSTREAM_BASE:
        return
    headers = {"Authorization": f"Bearer {UPSTREAM_KEY}"} if UPSTREAM_KEY else {}
    try:
        response = httpx.get(f"{UPSTREAM_V1}/models", headers=headers, timeout=15)
        response.raise_for_status()
        names = [str(item["id"]) for item in response.json().get("data", []) if item.get("id")]
    except (httpx.HTTPError, KeyError, ValueError) as error:
        print(f"[channel] 拉取上游模型失败，使用兜底目录：{error}")
        return
    if not names:
        return
    MODELS = catalog_with_images([
        {"id": index, "code_name": name, "type": classify_model(name), "ability": "上游提供", "quality": "标准",
         "input_price": DEFAULT_INPUT_PRICE, "output_price": DEFAULT_OUTPUT_PRICE, "illustrate": f"{name}（来自上游）"}
        for index, name in enumerate(names, start=1)
    ])
    PRICING = {model["code_name"]: model for model in MODELS}
    image_count = sum(1 for model in MODELS if model["type"] == "image")
    print(f"[channel] 已加载模型 {len(MODELS)} 个（图片 {image_count} 个）：{', '.join(names[:6])}{' …' if len(names) > 6 else ''}")

RECHARGE_PLANS = [
    {"id": 1, "money": 10, "integral": 10, "describe": "入门体验", "amount": 10, "points": 10,
     "bonusAmount": 0, "bonusRate": 0, "totalAmount": 10},
    {"id": 2, "money": 50, "integral": 55, "describe": "含 10% 赠送", "amount": 50, "points": 55,
     "bonusAmount": 5, "bonusRate": 0.1, "totalAmount": 55},
    {"id": 3, "money": 100, "integral": 120, "describe": "含 20% 赠送", "amount": 100, "points": 120,
     "bonusAmount": 20, "bonusRate": 0.2, "totalAmount": 120},
]


# ---------------------------------------------------------------- 基础设施

def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT UNIQUE NOT NULL,
                phone TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance REAL NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                key TEXT UNIQUE NOT NULL,
                state INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                goods_name TEXT NOT NULL,
                amount REAL NOT NULL,
                points REAL NOT NULL,
                order_number TEXT UNIQUE NOT NULL,
                type INTEGER NOT NULL DEFAULT 1,
                status INTEGER NOT NULL DEFAULT 0,
                way_code TEXT,
                remark TEXT,
                creation_time INTEGER NOT NULL,
                payment_time INTEGER
            );
            CREATE TABLE IF NOT EXISTS usage_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                key_id INTEGER,
                task_code TEXT NOT NULL,
                model_name TEXT NOT NULL,
                input_tokens INTEGER NOT NULL,
                output_tokens INTEGER NOT NULL,
                amount REAL NOT NULL,
                creation_time INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS plugins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                identifier TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                desc TEXT,
                file_name TEXT NOT NULL,
                file_key TEXT NOT NULL,
                demo_video_key TEXT,
                cover_key TEXT,
                state INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS plugin_collections (
                user_id INTEGER NOT NULL,
                plugin_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, plugin_id)
            );
            """
        )


def ok(data=None, message: str = "成功") -> JSONResponse:
    return JSONResponse({"code": 200, "data": data, "message": message})


def fail(message: str, code: int = 400) -> JSONResponse:
    """失败响应：HTTP 状态与业务码保持一致，避免被中间层当作 200 缓存。"""
    status = code if 400 <= code <= 599 else 200
    return JSONResponse({"code": code, "data": None, "message": message}, status_code=status)


def now() -> int:
    return int(time.time())


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(password, salt), stored)


def issue_token(user_id: int, user_name: str) -> str:
    payload = {"uid": user_id, "name": user_name, "exp": now() + TOKEN_TTL}
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    signature = hmac.new(TOKEN_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def read_token(token: str) -> dict | None:
    try:
        body, signature = token.split(".", 1)
    except ValueError:
        return None
    expected = hmac.new(TOKEN_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(body.encode()))
    except Exception:
        return None
    return payload if payload.get("exp", 0) > now() else None


def bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        return ""
    return authorization[7:].strip()


def identify(authorization: str | None) -> tuple[dict | None, int | None]:
    """返回 (用户, 凭证 ID)。支持登录令牌与 sk-cm- 凭证两种凭据。"""
    token = bearer(authorization)
    if not token:
        return None, None
    if token.startswith("sk-cm-"):
        with db() as connection:
            row = connection.execute(
                "SELECT k.id AS key_id, u.id AS uid, u.user_name AS name FROM api_keys k "
                "JOIN users u ON u.id = k.user_id WHERE k.key = ? AND k.state = 1", (token,)
            ).fetchone()
        if not row:
            return None, None
        return {"uid": row["uid"], "name": row["name"]}, row["key_id"]
    payload = read_token(token)
    return (payload, None) if payload else (None, None)


def require_user(authorization: str | None) -> dict | JSONResponse:
    user, _ = identify(authorization)
    return user or fail("登录已过期，请重新登录", 401)


# ---------------------------------------------------------------- 验证码与短信

def captcha_svg(text: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50" viewBox="0 0 150 50">'
        '<rect width="150" height="50" fill="#f5f7fa"/>'
        f'<text x="75" y="34" font-size="26" font-family="monospace" fill="#303133" '
        f'text-anchor="middle" letter-spacing="6">{text}</text></svg>'
    )


def issue_captcha() -> dict:
    """验证码文本只存在服务端，下发给客户端的是票据 ID。"""
    text = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    ticket = secrets.token_urlsafe(16)
    current = time.time()
    for key, (_, expires) in list(_captchas.items()):
        if expires < current:
            _captchas.pop(key, None)
    _captchas[ticket] = (text.lower(), current + CAPTCHA_TTL)
    return {"svg": captcha_svg(text), "captcha": ticket}


def check_captcha(ticket: str, typed: str) -> bool:
    record = _captchas.pop(ticket, None)  # 一次性：无论对错都作废，避免爆破
    if not record or record[1] < time.time():
        return False
    return hmac.compare_digest(record[0], (typed or "").strip().lower())


def issue_sms(phone: str) -> str:
    code = "".join(random.choices(string.digits, k=6))
    current = time.time()
    _sms_codes[phone] = (code, current + SMS_TTL, current)
    return code


def deliver_sms(phone: str, code: str) -> None:
    """默认打印到日志；配置 CHANNEL_SMS_WEBHOOK 后转发给真实短信服务。"""
    if not SMS_WEBHOOK:
        print(f"[channel] 短信验证码 phone={phone} code={code}（未配置 CHANNEL_SMS_WEBHOOK，仅打印）")
        return
    try:
        response = httpx.post(SMS_WEBHOOK, json={"phone": phone, "code": code, "template": "login"}, timeout=10)
        if response.status_code >= 400:
            print(f"[channel] 短信网关返回 {response.status_code}: {response.text[:200]}")
    except httpx.HTTPError as error:
        print(f"[channel] 短信网关调用失败: {error}")


def verify_sms(phone: str, code: str) -> bool:
    record = _sms_codes.get(phone)
    if not record or record[1] < time.time():
        return False
    if not hmac.compare_digest(record[0], (code or "").strip()):
        return False
    _sms_codes.pop(phone, None)  # 一次性
    return True


# ---------------------------------------------------------------- 鉴权

@app.get("/web/toonflow/user/getCaptcha")
def get_captcha():
    return ok(issue_captcha())


@app.post("/web/toonflow/user/sendSmsCode")
async def send_sms(request: Request):
    body = await request.json()
    phone = str(body.get("phone", "")).strip()
    if len(phone) < 6:
        return fail("请输入有效的手机号")
    record = _sms_codes.get(phone)
    if record and time.time() - record[2] < SMS_COOLDOWN:
        return fail(f"发送过于频繁，请 {int(SMS_COOLDOWN - (time.time() - record[2]))} 秒后重试")
    code = issue_sms(phone)
    deliver_sms(phone, code)
    return ok(SMS_TTL)


@app.post("/web/toonflow/user/register")
async def register(request: Request):
    body = await request.json()
    user_name = str(body.get("userName", "")).strip()
    phone = str(body.get("phone", "")).strip()
    password = str(body.get("password", ""))
    code = str(body.get("verificationCode", "")).strip()
    if not user_name or not phone or len(password) < 6:
        return fail("用户名、手机号与不少于 6 位的密码为必填项")
    if not verify_sms(phone, code):
        return fail("短信验证码不正确或已过期")
    with db() as connection:
        if connection.execute("SELECT 1 FROM users WHERE user_name = ? OR phone = ?", (user_name, phone)).fetchone():
            return fail("用户名或手机号已被注册")
        cursor = connection.execute(
            "INSERT INTO users (user_name, phone, password, balance, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_name, phone, hash_password(password), INITIAL_BALANCE, now()),
        )
        user_id = cursor.lastrowid
    return ok({"userCode": f"U{user_id:06d}"}, "注册成功")


@app.post("/web/toonflow/user/login")
async def login(request: Request):
    body = await request.json()
    user_name = str(body.get("userName", "")).strip()
    if not check_captcha(str(body.get("originalCaptcha", "")), str(body.get("captcha", ""))):
        return fail("图形验证码不正确或已过期")
    with db() as connection:
        user = connection.execute("SELECT * FROM users WHERE user_name = ?", (user_name,)).fetchone()
    if not user or not verify_password(str(body.get("password", "")), user["password"]):
        return fail("用户名或密码不正确", 401)
    return ok({"token": issue_token(user["id"], user["user_name"]), "info": {"userName": user["user_name"], "phone": user["phone"]}})


@app.post("/web/toonflow/user/forgotPassword")
async def forgot_password(request: Request):
    body = await request.json()
    phone = str(body.get("phone", "")).strip()
    password = str(body.get("newPassword", ""))
    if password != str(body.get("confirmPassword", "")):
        return fail("两次输入的密码不一致")
    if len(password) < 6:
        return fail("密码不能少于 6 位")
    if not verify_sms(phone, str(body.get("verificationCode", ""))):
        return fail("短信验证码不正确或已过期")
    with db() as connection:
        connection.execute("UPDATE users SET password = ? WHERE phone = ?", (hash_password(password), phone))
    return ok("密码已重置，请重新登录")


# ---------------------------------------------------------------- 凭证

def key_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "key": row["key"], "balance": 0, "groupId": 1,
        "quotaType": 0, "expirationType": 0, "expirationTime": 0, "creationTime": row["created_at"],
        "state": row["state"],
    }


@app.get("/web/web/key/getKeyData")
def get_key_data(
    authorization: str | None = Header(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=100),
    key: str = Query(default=""),
):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    with db() as connection:
        rows = connection.execute(
            "SELECT * FROM api_keys WHERE user_id = ? AND key LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?",
            (user["uid"], f"%{key}%", limit, (page - 1) * limit),
        ).fetchall()
        total = connection.execute(
            "SELECT COUNT(*) AS c FROM api_keys WHERE user_id = ? AND key LIKE ?", (user["uid"], f"%{key}%")
        ).fetchone()["c"]
    return ok({"total": total, "data": [key_row(row) for row in rows]})


@app.post("/web/web/key/addKey")
async def add_key(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    name = str(body.get("name", "")).strip()
    if not name:
        return fail("请输入凭证名称")
    value = f"sk-cm-{secrets.token_hex(16)}"
    with db() as connection:
        connection.execute(
            "INSERT INTO api_keys (user_id, name, key, created_at) VALUES (?, ?, ?, ?)",
            (user["uid"], name, value, now()),
        )
    return ok("凭证已创建")


@app.post("/web/web/key/delKey")
async def del_key(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    with db() as connection:
        connection.execute("DELETE FROM api_keys WHERE id = ? AND user_id = ?", (body.get("id"), user["uid"]))
    return ok("凭证已删除")


# ---------------------------------------------------------------- 模型目录

@app.get("/web/web/model/getModelData")
def get_model_data(authorization: str | None = Header(default=None), type: str = Query(default="all")):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    data = []
    for model in MODELS:
        if type != "all" and model["type"] != type:
            continue
        if model["type"] == "image":
            billing_data = {"fixedPrice": model.get("unit_price", IMAGE_PRICE)}
            price_unit_key, price_unit = "image", "1 张"
        else:
            billing_data = {"inputPrice": model["input_price"], "outputPrice": model["output_price"]}
            price_unit_key, price_unit = "token", "1K tokens"
        data.append({
            "id": model["id"], "codeName": model["code_name"], "type": model["type"],
            "ability": model["ability"], "quality": model["quality"], "state": 1,
            "billingType": 0,
            "billingData": json.dumps(billing_data),
            "priceUnitKey": price_unit_key, "priceUnit": price_unit, "illustrate": model["illustrate"],
        })
    return ok(data)


MEDIA_PROVIDER_TEMPLATE = """const IMAGE_TIMEOUT = 300000;

function referenceUrl(input) {
  if (input.type === "url") return input.url;
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return "data:" + input.mimeType + ";base64," + data;
}

async function readFailure(response) {
  const text = await response.text().catch(function () { return ""; });
  try {
    const parsed = JSON.parse(text);
    const detail = parsed && parsed.error ? (parsed.error.message || parsed.error) : (parsed && parsed.message);
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  } catch (error) {
    // ACT: 非 JSON 错误正文按纯文本展示。
  }
  const plain = text.trim().slice(0, 300);
  return plain || ("HTTP " + response.status);
}

export default {
  id: "toonflow",
  label: "创梦账号",
  version: "2.1.0",
  apiUrl: "__API_BASE__",
  protocol: "openai-completions",
  token: "__TOKEN__",
  rules: [],
  models: [
__MODELS__
  ],
  async generateImage(request) {
    const token = typeof this.config.token === "string" ? this.config.token : "";
    if (!token) throw new Error("创梦账号未登录，请重新登录后刷新供应商");
    if (typeof request.prompt !== "string" || !request.prompt.trim()) throw new Error("请填写提示词");
    const images = (request.images || []).map(referenceUrl);
    const payload = { model: request.model, prompt: request.prompt, n: 1, size: request.size, ratio: request.ratio };
    if (request.quality) payload.quality = request.quality;
    if (request.outputFormat) payload.output_format = request.outputFormat;
    if (images.length) payload.images = images;
    const endpoint = images.length ? "/images/edits" : "/images/generations";
    const signal = AbortSignal.any([AbortSignal.timeout(IMAGE_TIMEOUT)].concat(this.signal ? [this.signal] : []));
    const response = await this.tool.fetch("__API_BASE__" + endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: signal,
    });
    if (!response.ok) throw new Error(await readFailure(response));
    const body = await response.json();
    const items = Array.isArray(body && body.data) ? body.data : [];
    const assets = [];
    for (const item of items) {
      if (item && typeof item.url === "string" && item.url) assets.push({ mediaType: "image", type: "url", url: item.url });
      else if (item && typeof item.b64_json === "string" && item.b64_json) assets.push({ mediaType: "image", type: "base64", data: item.b64_json, mimeType: "image/png" });
    }
    if (!assets.length) throw new Error("渠道未返回可用图片");
    return assets;
  },
};
"""


def image_model_line(model: dict) -> str:
    """按协议声明图片模型的可选尺寸/比例：Gemini 用档位，OpenAI 协议用像素。"""
    name = model["code_name"]
    label = MODEL_LABELS.get(name, name)
    if name in GEMINI_MODEL_SET:
        sizes = '["1K", "2K", "4K"]'
        ratios = '["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9"]'
    else:
        sizes = '["1024x1024", "1024x1536", "1536x1024", "2048x2048"]'
        ratios = '["1:1", "2:3", "3:2", "16:9", "9:16"]'
    return ('    { id: "%s", label: "%s", type: "image", mode: ["text", "singleImage", "multiReference"], '
            'imageSizes: %s, imageRatios: %s }' % (name, label, sizes, ratios))


@app.get("/web/web/provider/getProviderSource")
def get_provider_source(authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    token = bearer(authorization)
    model_lines = ",\n".join(
        f'    {{ id: "{model["code_name"]}", label: "{model["code_name"]}", type: "text", contextWindow: 65536, maxOutputTokens: 8192 }}'
        for model in MODELS if model["type"] == "text"
    )
    language = (
        "export default {\n"
        '  id: "toonflow",\n'
        '  label: "创梦账号",\n'
        '  version: "2.0.0",\n'
        f'  apiUrl: "{PUBLIC_BASE}/v1",\n'
        '  protocol: "openai-completions",\n'
        f'  token: "{token}",\n'
        "  rules: [],\n"
        "  models: [\n"
        f"{model_lines}\n"
        "  ],\n"
        "};\n"
    )
    image_lines = ",\n".join(image_model_line(model) for model in MODELS if model["type"] == "image")
    media = MEDIA_PROVIDER_TEMPLATE.replace("__API_BASE__", f"{PUBLIC_BASE}/v1") \
        .replace("__TOKEN__", token).replace("__MODELS__", image_lines)
    return ok({"language": language, "media": media})


# ---------------------------------------------------------------- 计量与代理

def cost_of(model_name: str, input_tokens: int, output_tokens: int) -> float:
    model = PRICING.get(model_name)
    if not model:
        return 0.0
    return (input_tokens / 1000) * model["input_price"] + (output_tokens / 1000) * model["output_price"]


def record_usage(user: dict, key_id: int | None, model_name: str, input_tokens: int, output_tokens: int) -> float:
    amount = round(cost_of(model_name, input_tokens, output_tokens), 6)
    with db() as connection:
        connection.execute("UPDATE users SET balance = balance - ? WHERE id = ?", (amount, user["uid"]))
        connection.execute(
            "INSERT INTO usage_records (user_id, key_id, task_code, model_name, input_tokens, output_tokens, amount, creation_time) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user["uid"], key_id, f"T{secrets.token_hex(6)}", model_name, input_tokens, output_tokens, amount, now()),
        )
    return amount


def unit_price_of(model_name: str) -> float:
    model = PRICING.get(model_name) or {}
    try:
        return float(model.get("unit_price", IMAGE_PRICE))
    except (TypeError, ValueError):
        return IMAGE_PRICE


def balance_of(uid: int) -> float:
    with db() as connection:
        row = connection.execute("SELECT balance FROM users WHERE id = ?", (uid,)).fetchone()
    return float(row["balance"]) if row else 0.0


def record_image_usage(user: dict, key_id: int | None, model_name: str, count: int) -> float:
    """图片按张计费：成功后一次性扣除，用量记录为 0 token。"""
    amount = round(unit_price_of(model_name) * max(count, 1), 6)
    with db() as connection:
        connection.execute("UPDATE users SET balance = balance - ? WHERE id = ?", (amount, user["uid"]))
        connection.execute(
            "INSERT INTO usage_records (user_id, key_id, task_code, model_name, input_tokens, output_tokens, amount, creation_time) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user["uid"], key_id, f"T{secrets.token_hex(6)}", model_name, 0, 0, amount, now()),
        )
    return amount


def normalize_image_size(size: object, ratio: object) -> str:
    """坤柔按「宽x高」接收（文档示例 1024x1536）；兼容 1024*1024、1K/2K/4K 等写法。"""
    raw = str(size or "").strip()
    if raw:
        normalized = raw.replace("*", "x").replace("×", "x").replace("X", "x")
        if re.fullmatch(r"\d{2,5}x\d{2,5}", normalized):
            return normalized
        tokens = {"1K": "1024x1024", "2K": "2048x2048", "4K": "4096x4096"}
        if raw.upper() in tokens:
            return tokens[raw.upper()]
    return IMAGE_RATIO_SIZES.get(str(ratio or "").strip(), IMAGE_DEFAULT_SIZE)


def gemini_size_token(size: object) -> str:
    """Gemini 按档位（512/1K/2K/4K）指定分辨率；像素尺寸按最长边换算。"""
    raw = str(size or "").strip().upper()
    if raw in GEMINI_SIZE_TOKENS:
        return raw
    match = re.fullmatch(r"(\d{2,5})[X*×](\d{2,5})", raw)
    if match:
        longest = max(int(match.group(1)), int(match.group(2)))
        if longest >= 3000:
            return "4K"
        if longest >= 1500:
            return "2K"
    return "1K"


async def serve_gemini_image(user: dict, key_id: int | None, model_name: str, prompt: str, payload: dict):
    """Gemini 原生协议：POST /v1beta/models/{model}:generateContent，返回统一成 OpenAI 结构。"""
    if not GEMINI_UPSTREAM_KEY:
        return JSONResponse({"error": {"message": "渠道未配置 Gemini 图片 Key（CHANNEL_GEMINI_UPSTREAM_KEY）", "type": "server_error"}}, status_code=503)

    parts: list[dict] = [{"text": prompt}]
    images = payload.get("images")
    if isinstance(images, list):
        for item in images[:8]:
            value = str(item)
            if value.startswith("data:"):
                header, _, data = value.partition(",")
                mime = header[5:].split(";")[0] or "image/png"
                parts.append({"inlineData": {"mimeType": mime, "data": data}})
            elif value.startswith(("http://", "https://")):
                parts.append({"fileData": {"fileUri": value}})

    image_config: dict[str, str] = {"imageSize": gemini_size_token(payload.get("size"))}
    ratio = str(payload.get("ratio") or "").strip()
    if re.fullmatch(r"[1-9]\d{0,3}:[1-9]\d{0,3}", ratio):
        image_config["aspectRatio"] = ratio
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"candidateCount": 1, "responseModalities": ["IMAGE"], "imageConfig": image_config},
    }

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {GEMINI_UPSTREAM_KEY}"}
    timeout = httpx.Timeout(600.0, connect=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(f"{GEMINI_UPSTREAM_BASE}/v1beta/models/{model_name}:generateContent", headers=headers, json=body)
    except httpx.HTTPError as error:
        return JSONResponse({"error": {"message": f"上游 Gemini 图片服务不可达：{error}", "type": "upstream_error"}}, status_code=502)

    try:
        data = response.json()
    except ValueError:
        data = None
    if response.status_code >= 400 or not isinstance(data, dict):
        detail: object = ""
        if isinstance(data, dict):
            error = data.get("error")
            detail = error.get("message") if isinstance(error, dict) else (error if isinstance(error, str) else "")
        message = detail.strip() if isinstance(detail, str) and detail.strip() else f"上游 Gemini 图片服务返回 HTTP {response.status_code}"
        return JSONResponse({"error": {"message": message, "type": "upstream_error"}}, status_code=response.status_code if response.status_code >= 400 else 502)

    assets: list[dict] = []
    for candidate in (data.get("candidates") or [])[:1]:
        for part in ((candidate or {}).get("content") or {}).get("parts") or []:
            inline = part.get("inlineData") if isinstance(part, dict) else None
            if isinstance(inline, dict) and isinstance(inline.get("data"), str) and inline["data"]:
                assets.append({"b64_json": inline["data"]})
    if not assets:
        feedback = data.get("promptFeedback") if isinstance(data.get("promptFeedback"), dict) else {}
        reason = str(feedback.get("blockReason") or "").strip()
        return JSONResponse({"error": {"message": f"上游未返回图片{('（' + reason + '）') if reason else ''}", "type": "upstream_error"}}, status_code=502)

    record_image_usage(user, key_id, model_name, len(assets))
    return JSONResponse({"created": int(time.time()), "data": assets}, status_code=200)


async def serve_image(request: Request, authorization: str | None, edit: bool):
    """图片生成/编辑统一入口：鉴权 → 余额校验 → 转发上游 → 成功后按张扣费。"""
    user, key_id = identify(authorization)
    if not user:
        return JSONResponse({"error": {"message": "凭据无效，请重新登录或在设置中生成凭证", "type": "invalid_request_error"}}, status_code=401)
    if not IMAGE_UPSTREAM_V1:
        return JSONResponse({"error": {"message": "渠道未配置图片上游（CHANNEL_IMAGE_UPSTREAM_BASE）", "type": "server_error"}}, status_code=503)

    try:
        payload = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse({"error": {"message": "请求体不是合法 JSON"}}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"error": {"message": "请求体必须是 JSON 对象"}}, status_code=400)

    model_name = str(payload.get("model") or "")
    model = PRICING.get(model_name)
    if not model or model.get("type") != "image":
        return JSONResponse({"error": {"message": f"图片模型不存在：{model_name or '未指定'}", "type": "invalid_request_error"}}, status_code=404)
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        return JSONResponse({"error": {"message": "prompt 不能为空", "type": "invalid_request_error"}}, status_code=400)

    # ACT: 坤柔文档规定图片接口 n 固定为 1，需要多张时多次调用，按实际返回张数计费。
    count = 1
    cost = round(unit_price_of(model_name) * count, 6)
    balance = balance_of(user["uid"])
    if balance < cost:
        return JSONResponse({"error": {"message": f"余额不足：本次需 {cost:.2f} 元，当前 {balance:.2f} 元", "type": "insufficient_quota"}}, status_code=402)

    if model_name in GEMINI_MODEL_SET:
        return await serve_gemini_image(user, key_id, model_name, prompt, payload)

    body: dict[str, object] = {
        "model": model_name,
        "prompt": prompt,
        "n": count,
        "size": normalize_image_size(payload.get("size"), payload.get("ratio")),
        "response_format": "url",
    }
    for field in ("quality", "background", "output_format"):
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            body[field] = value.strip()

    if edit:
        images = payload.get("images")
        if not isinstance(images, list) or not images:
            return JSONResponse({"error": {"message": "图片编辑需要提供参考图"}}, status_code=400)
        # ACT: 文档支持 JSON 的 images 数组（Base64 data URL 或 HTTP 直链），直接透传即可。
        body["images"] = [str(item) for item in images[:8]]

    headers = {"Content-Type": "application/json"}
    if IMAGE_UPSTREAM_KEY:
        headers["Authorization"] = f"Bearer {IMAGE_UPSTREAM_KEY}"
    endpoint = "edits" if edit else "generations"
    timeout = httpx.Timeout(300.0, connect=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(f"{IMAGE_UPSTREAM_V1}/images/{endpoint}", headers=headers, json=body)
    except httpx.HTTPError as error:
        return JSONResponse({"error": {"message": f"上游图片服务不可达：{error}", "type": "upstream_error"}}, status_code=502)

    try:
        body = response.json()
    except ValueError:
        body = None
    if response.status_code >= 400 or not isinstance(body, dict):
        message: object = ""
        if isinstance(body, dict):
            error = body.get("error")
            message = error.get("message") if isinstance(error, dict) else (error if isinstance(error, str) else "")
        detail = message.strip() if isinstance(message, str) and message.strip() else f"上游图片服务返回 HTTP {response.status_code}"
        return JSONResponse({"error": {"message": detail, "type": "upstream_error"}}, status_code=response.status_code if response.status_code >= 400 else 502)

    produced = body.get("data") if isinstance(body.get("data"), list) else []
    record_image_usage(user, key_id, model_name, len(produced) or count)
    return JSONResponse(body, status_code=response.status_code)


@app.post("/v1/images/generations")
async def image_generations(request: Request, authorization: str | None = Header(default=None)):
    return await serve_image(request, authorization, edit=False)


@app.post("/v1/images/edits")
async def image_edits(request: Request, authorization: str | None = Header(default=None)):
    return await serve_image(request, authorization, edit=True)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, authorization: str | None = Header(default=None)):
    user, key_id = identify(authorization)
    if not user:
        return JSONResponse({"error": {"message": "凭据无效，请重新登录或在设置中生成凭证", "type": "invalid_request_error"}}, status_code=401)
    if not UPSTREAM_BASE:
        return JSONResponse({"error": {"message": "渠道未配置上游模型服务（CHANNEL_UPSTREAM_BASE）", "type": "server_error"}}, status_code=503)

    with db() as connection:
        row = connection.execute("SELECT balance FROM users WHERE id = ?", (user["uid"],)).fetchone()
    balance = float(row["balance"]) if row else 0.0
    if balance <= 0:
        return JSONResponse({"error": {"message": "账户余额不足，请先充值", "type": "insufficient_quota"}}, status_code=402)

    payload = await request.body()
    try:
        parsed = json.loads(payload) if payload else {}
    except json.JSONDecodeError:
        return JSONResponse({"error": {"message": "请求体不是合法 JSON"}}, status_code=400)
    model_name = str(parsed.get("model", ""))
    streaming = bool(parsed.get("stream"))
    if streaming:
        parsed["stream_options"] = {**parsed.get("stream_options", {}), "include_usage": True}
        payload = json.dumps(parsed).encode()

    headers = {"Content-Type": "application/json"}
    if UPSTREAM_KEY:
        headers["Authorization"] = f"Bearer {UPSTREAM_KEY}"
    client = httpx.AsyncClient(timeout=None)
    upstream_request = client.build_request("POST", f"{UPSTREAM_V1}/chat/completions", content=payload, headers=headers)
    try:
        upstream = await client.send(upstream_request, stream=True)
    except httpx.HTTPError as error:
        await client.aclose()
        return JSONResponse({"error": {"message": f"上游模型服务不可达：{error}"}}, status_code=502)

    if upstream.status_code >= 400 or not streaming:
        raw = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        try:
            body = json.loads(raw)
            usage = body.get("usage") or {}
            if upstream.status_code < 400:
                record_usage(user, key_id, model_name, int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0)))
        except json.JSONDecodeError:
            pass
        return JSONResponse(content=json.loads(raw) if raw else {}, status_code=upstream.status_code)

    async def relay():
        buffer = b""
        usage = {"prompt_tokens": 0, "completion_tokens": 0}
        try:
            async for chunk in upstream.aiter_raw():
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    text = line.decode("utf-8", "ignore").strip()
                    if text.startswith("data:") and "usage" in text:
                        try:
                            event = json.loads(text[5:].strip())
                            found = event.get("usage") or {}
                            if found:
                                usage = {
                                    "prompt_tokens": int(found.get("prompt_tokens") or usage["prompt_tokens"]),
                                    "completion_tokens": int(found.get("completion_tokens") or usage["completion_tokens"]),
                                }
                        except (json.JSONDecodeError, TypeError, ValueError):
                            pass
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()
            record_usage(user, key_id, model_name, usage["prompt_tokens"], usage["completion_tokens"])

    return StreamingResponse(relay(), status_code=upstream.status_code, media_type="text/event-stream")


@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": [{"id": model["code_name"], "object": "model", "owned_by": "dreammuse"} for model in MODELS]}


# ---------------------------------------------------------------- 钱包

@app.get("/web/web/recharge/getRechargeData")
def recharge_data(authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    return ok(RECHARGE_PLANS)


@app.get("/web/web/recharge/getPresentation")
def recharge_presentation(authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    return ok({"agreement": None, "activities": [], "pricing": {"rechargeDiscount": 1, "agentFirstRecharge": False}, "serverTime": now()})


@app.get("/web/web/recharge/getActivity")
def recharge_activity(authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    return ok({"eligible": False, "firstRechargeDiscount": 1, "serverTime": now()})


@app.get("/web/web/recharge/getBonusBatches")
def bonus_batches(authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    return ok({"data": [], "total": 0, "summary": {"availableAmount": 0, "expiringSoonAmount": 0, "nextExpiresAt": None,
                                                   "counts": {"available": 0, "used": 0, "expired": 0}}})


@app.post("/web/web/recharge/exchange")
async def exchange(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    code = str(body.get("code", "")).strip()
    if not code:
        return fail("请输入兑换码")
    return fail("兑换码无效或已使用")


@app.post("/web/web/recharge/pay")
async def pay(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    return fail("当前渠道未接入支付服务，请联系管理员充值")


@app.get("/web/web/recharge/queryOrder")
def query_order(orderNumber: str = Query(default=""), authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    with db() as connection:
        row = connection.execute("SELECT status FROM orders WHERE order_number = ? AND user_id = ?", (orderNumber, user["uid"])).fetchone()
    if not row:
        return fail("订单不存在", 404)
    return ok({"status": row["status"]})


@app.get("/web/web/order/getOrder")
def order_list(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=100),
    authorization: str | None = Header(default=None),
):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    with db() as connection:
        rows = connection.execute(
            "SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
            (user["uid"], limit, (page - 1) * limit),
        ).fetchall()
        total = connection.execute("SELECT COUNT(*) AS c FROM orders WHERE user_id = ?", (user["uid"],)).fetchone()["c"]
    data = [{
        "id": row["id"], "goodsName": row["goods_name"], "amount": row["amount"], "points": row["points"],
        "orderNumber": row["order_number"], "type": row["type"], "status": row["status"], "wayCode": row["way_code"],
        "creationTime": row["creation_time"], "paymentTime": row["payment_time"], "remark": row["remark"],
        "bonusAmount": 0, "bonusActivityName": None, "bonusExpireMode": None, "bonusValidDays": None, "bonusExpiresAt": None,
    } for row in rows]
    return ok({"data": data, "total": total})


@app.get("/web/web/pointsPreview/getPreviewData")
def preview_data(authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    with db() as connection:
        balance = connection.execute("SELECT balance FROM users WHERE id = ?", (user["uid"],)).fetchone()["balance"]
        rows = connection.execute(
            "SELECT creation_time, SUM(amount) AS total FROM usage_records WHERE user_id = ? GROUP BY date(creation_time, 'unixepoch')",
            (user["uid"],),
        ).fetchall()
        consumed = connection.execute("SELECT COALESCE(SUM(amount), 0) AS s FROM usage_records WHERE user_id = ?", (user["uid"],)).fetchone()["s"]
    daily = [
        {"date": datetime.fromtimestamp(row["creation_time"], timezone.utc).strftime("%Y-%m-%d"), "total": round(row["total"], 6)}
        for row in rows
    ]
    return ok({"totalPoints": round(float(balance), 4), "bonusBalance": 0, "totalConsumption": round(float(consumed), 4), "daily": daily})


@app.post("/web/web/pointsPreview/getUsageStatistics")
async def usage_statistics(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    start = int(body.get("startTime", 0))
    finish = int(body.get("finishTime", now()))
    with db() as connection:
        rows = connection.execute(
            "SELECT model_name, amount, creation_time FROM usage_records WHERE user_id = ? AND creation_time BETWEEN ? AND ?",
            (user["uid"], start // 1000 if start > 10**12 else start, finish // 1000 if finish > 10**12 else finish),
        ).fetchall()
    days = max(1, min(31, int((finish - start) / 86400000) + 1))
    dates = [(datetime.fromtimestamp(start / 1000, timezone.utc) + timedelta(days=index)).strftime("%Y-%m-%d") for index in range(days)]
    totals: dict[str, list[float | None]] = {}
    for row in rows:
        day = datetime.fromtimestamp(row["creation_time"], timezone.utc).strftime("%Y-%m-%d")
        if day not in dates:
            continue
        series = totals.setdefault(row["model_name"], [0.0] * len(dates))
        series[dates.index(day)] = (series[dates.index(day)] or 0) + row["amount"]
    return ok({
        "summary": {"totalRequests": len(rows), "totalAmount": round(sum(row["amount"] for row in rows), 6)},
        "dates": dates,
        "series": [{"name": name, "data": values} for name, values in totals.items()],
        "models": sorted(totals.keys()),
        "keys": [],
    })


@app.post("/web/web/query/getPointsConsumption")
async def points_consumption(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    start = int(body.get("startTime", 0))
    finish = int(body.get("finishTime", now()))
    start = start // 1000 if start > 10**12 else start
    finish = finish // 1000 if finish > 10**12 else finish
    with db() as connection:
        row = connection.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM usage_records "
            "WHERE user_id = ? AND creation_time BETWEEN ? AND ?", (user["uid"], start, finish),
        ).fetchone()
    return ok({"total": round(float(row["total"]), 6), "count": row["count"]})


@app.get("/web/web/operationLog/getOperationLog")
def operation_log(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=100),
    taskICode: str = Query(default=""),
    authorization: str | None = Header(default=None),
):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    with db() as connection:
        rows = connection.execute(
            "SELECT * FROM usage_records WHERE user_id = ? AND task_code LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?",
            (user["uid"], f"%{taskICode}%", limit, (page - 1) * limit),
        ).fetchall()
        total = connection.execute(
            "SELECT COUNT(*) AS c FROM usage_records WHERE user_id = ? AND task_code LIKE ?", (user["uid"], f"%{taskICode}%")
        ).fetchone()["c"]
    data = [{
        "id": row["id"], "taskICode": row["task_code"], "modelName": row["model_name"], "price": row["amount"],
        "timeConsuming": None, "state": 1, "extractUrl": None, "keyName": None, "errorReason": None,
        "creationTime": row["creation_time"], "completionTime": row["creation_time"],
    } for row in rows]
    return ok({"data": data, "total": total})


# ---------------------------------------------------------------- 插件市场

STORAGE = os.path.join(os.path.dirname(__file__), "storage")
os.makedirs(STORAGE, exist_ok=True)

MEDIA_TYPES = {
    ".mp4": "video/mp4", ".webm": "video/webm",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
}


@app.post("/web/web/plugIn/getUploadSignature")
async def plugin_upload_signature(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    kind = str(body.get("kind", ""))
    file_name = str(body.get("fileName", ""))
    if kind not in {"video", "cover"}:
        return fail("素材类型无效")
    extension = os.path.splitext(file_name)[1].lower()
    content_type = MEDIA_TYPES.get(extension)
    allowed = {"video": {".mp4", ".webm"}, "cover": {".jpg", ".jpeg", ".png", ".webp"}}
    if not content_type or extension not in allowed[kind]:
        return fail("不支持的素材格式")
    key = f"media/{kind}-{secrets.token_hex(12)}{extension}"
    return ok({"uploadUrl": f"{PUBLIC_BASE}/upload/{key}", "fileKey": key, "contentType": content_type})


@app.put("/upload/{key:path}")
async def upload_object(key: str, request: Request):
    target = os.path.join(STORAGE, key)
    if not os.path.abspath(target).startswith(os.path.abspath(STORAGE)):
        return JSONResponse({"message": "路径非法"}, status_code=400)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    data = await request.body()
    if len(data) > 200 * 1024 * 1024:
        return JSONResponse({"message": "文件超过 200 MB"}, status_code=413)
    with open(target, "wb") as handle:
        handle.write(data)
    return JSONResponse({"ok": True, "size": len(data)})


@app.get("/files/{key:path}")
def read_object(key: str):
    target = os.path.join(STORAGE, key)
    if not os.path.abspath(target).startswith(os.path.abspath(STORAGE)) or not os.path.isfile(target):
        return JSONResponse({"message": "文件不存在"}, status_code=404)
    from fastapi.responses import FileResponse
    return FileResponse(target)


def save_data_uri(value: str, prefix: str, extension: str = ".js") -> str:
    """保存 data URI 或裸 base64 内容，返回存储键。"""
    payload = value
    if "," in value and value.strip().lower().startswith("data:"):
        header, payload = value.split(",", 1)
        extension = ".zip" if "zip" in header.lower() else ".js"
    try:
        binary = base64.b64decode(payload, validate=True)
    except Exception:
        return ""
    if not binary:
        return ""
    key = f"plugins/{prefix}-{secrets.token_hex(12)}{extension}"
    target = os.path.join(STORAGE, key)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as handle:
        handle.write(binary)
    return key


@app.post("/web/web/plugIn/uploadPlugin")
async def upload_plugin(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    name = str(body.get("name", "")).strip()
    identifier = str(body.get("identifier", "")).strip()
    plugin_type = str(body.get("type", ""))
    file_name = str(body.get("fileName", "")).strip()
    version = str(body.get("version", "")).strip()
    if not name or not identifier or not file_name or not version:
        return fail("名称、标识、文件名与版本号为必填项")
    if plugin_type not in {"node", "tool", "skill", "agent", "ext"}:
        return fail("不支持的插件类型")
    if not file_name.lower().endswith((".js", ".zip")):
        return fail("插件文件只支持 .js 或 .zip")
    file_key = save_data_uri(str(body.get("fileBase64", "")), f"{plugin_type}-{identifier}", os.path.splitext(file_name)[1].lower() or ".js")
    if not file_key:
        return fail("插件文件内容无效")
    with db() as connection:
        exists = connection.execute(
            "SELECT 1 FROM plugins WHERE identifier = ? AND type = ? AND owner_id = ?", (identifier, plugin_type, user["uid"])
        ).fetchone()
        if exists:
            return fail("同类型同标识的插件已存在，请使用更新")
        connection.execute(
            "INSERT INTO plugins (owner_id, identifier, type, name, version, desc, file_name, file_key, demo_video_key, cover_key, state, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
            (user["uid"], identifier, plugin_type, name, version, str(body.get("desc", "") or ""), file_name, file_key,
             body.get("demoVideoKey"), body.get("coverKey"), now(), now()),
        )
    return ok("插件已提交并上架")


@app.post("/web/web/plugIn/updatePlugin")
async def update_plugin(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    plugin_id = body.get("id")
    if not isinstance(plugin_id, int) or plugin_id < 1:
        return fail("插件 ID 无效")
    with db() as connection:
        row = connection.execute("SELECT * FROM plugins WHERE id = ?", (plugin_id,)).fetchone()
        if not row or row["owner_id"] != user["uid"]:
            return fail("插件不存在或无权修改", 404)
        file_key = row["file_key"]
        payload = str(body.get("fileBase64", ""))
        if payload:
            file_key = save_data_uri(payload, f"{row['type']}-{row['identifier']}", os.path.splitext(row["file_name"])[1].lower() or ".js") or file_key
        connection.execute(
            "UPDATE plugins SET name = ?, version = ?, desc = ?, file_name = ?, file_key = ?, "
            "demo_video_key = COALESCE(?, demo_video_key), cover_key = COALESCE(?, cover_key), updated_at = ? WHERE id = ?",
            (str(body.get("name", row["name"])).strip() or row["name"], str(body.get("version", row["version"])).strip() or row["version"],
             str(body.get("desc", row["desc"]) or ""), str(body.get("fileName", row["file_name"])).strip() or row["file_name"],
             file_key, body.get("demoVideoKey"), body.get("coverKey"), now(), plugin_id),
        )
    return ok("插件已更新")


@app.post("/web/web/plugIn/deletePlugin")
async def delete_plugin(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    with db() as connection:
        row = connection.execute("SELECT * FROM plugins WHERE id = ?", (body.get("id"),)).fetchone()
        if not row or row["owner_id"] != user["uid"]:
            return fail("插件不存在或无权删除", 404)
        connection.execute("DELETE FROM plugins WHERE id = ?", (row["id"],))
        connection.execute("DELETE FROM plugin_collections WHERE plugin_id = ?", (row["id"],))
    return ok("插件已删除")


@app.post("/web/web/plugIn/getPlugIn")
async def list_plugins(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    page = max(1, int(body.get("page", 1)))
    limit = min(50, max(1, int(body.get("limit", 10))))
    plugin_type = str(body.get("type", "all"))
    keyword = str(body.get("searchKeyword", "") or "").strip()

    where = ["state = 1"]
    params: list[object] = []
    if plugin_type == "my":
        where.append("owner_id = ?")
        params.append(user["uid"])
    elif plugin_type == "collection":
        where.append("id IN (SELECT plugin_id FROM plugin_collections WHERE user_id = ?)")
        params.append(user["uid"])
    elif plugin_type != "all":
        where.append("type = ?")
        params.append(plugin_type)
    if keyword:
        where.append("(name LIKE ? OR identifier LIKE ?)")
        params.extend([f"%{keyword}%", f"%{keyword}%"])
    clause = " AND ".join(where)

    with db() as connection:
        total = connection.execute(f"SELECT COUNT(*) AS c FROM plugins WHERE {clause}", params).fetchone()["c"]
        rows = connection.execute(
            f"SELECT * FROM plugins WHERE {clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            [*params, limit, (page - 1) * limit],
        ).fetchall()
        collected = {row["plugin_id"] for row in connection.execute(
            "SELECT plugin_id FROM plugin_collections WHERE user_id = ?", (user["uid"],)).fetchall()}

    data = []
    for row in rows:
        item = {
            "id": row["id"], "identifier": row["identifier"], "type": row["type"], "name": row["name"],
            "state": row["state"], "version": row["version"], "desc": row["desc"] or "",
            "fileName": row["file_name"], "link": f"{PUBLIC_BASE}/files/{row['file_key']}",
            "isCollected": row["id"] in collected, "tags": [],
        }
        if row["cover_key"]:
            item["coverUrl"] = f"{PUBLIC_BASE}/files/{row['cover_key']}"
        if row["demo_video_key"]:
            item["demoVideoUrl"] = f"{PUBLIC_BASE}/files/{row['demo_video_key']}"
        data.append(item)
    return ok({"list": data, "total": total})


@app.post("/web/web/plugIn/getPluginExistence")
async def plugin_existence(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    identities = body.get("plugins") or []
    with db() as connection:
        result = []
        for identity in identities:
            plugin_type = str(identity.get("type", ""))
            identifier = str(identity.get("identifier", ""))
            row = connection.execute(
                "SELECT 1 FROM plugins WHERE identifier = ? AND type = ? AND state = 1", (identifier, plugin_type)
            ).fetchone()
            result.append({"type": plugin_type, "identifier": identifier, "exists": bool(row)})
    return ok(result)


@app.post("/web/web/plugIn/toggleCollection")
async def toggle_collection(request: Request, authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    if isinstance(user, JSONResponse):
        return user
    body = await request.json()
    plugin_id = body.get("pluginId")
    if not isinstance(plugin_id, int) or plugin_id < 1:
        return fail("插件 ID 必须为正整数")
    with db() as connection:
        if not connection.execute("SELECT 1 FROM plugins WHERE id = ?", (plugin_id,)).fetchone():
            return fail("插件不存在", 404)
        existing = connection.execute(
            "SELECT 1 FROM plugin_collections WHERE user_id = ? AND plugin_id = ?", (user["uid"], plugin_id)
        ).fetchone()
        if existing:
            connection.execute("DELETE FROM plugin_collections WHERE user_id = ? AND plugin_id = ?", (user["uid"], plugin_id))
            collected = False
        else:
            connection.execute("INSERT INTO plugin_collections (user_id, plugin_id, created_at) VALUES (?, ?, ?)",
                               (user["uid"], plugin_id, now()))
            collected = True
    return ok({"collected": collected})


# ---------------------------------------------------------------- 空数据桩

EMPTY_STUBS: dict[tuple[str, str], object] = {
    ("POST", "/v1/explore/getProjects"): {"total": 0, "list": []},
    ("POST", "/v1/explore/getProject"): {},
    ("POST", "/v1/explore/getProcess"): {},
    ("POST", "/v1/explore/getDownload"): {"downloadUrl": ""},
    ("POST", "/web/sponsor/getSponsorList"): [],
    ("POST", "/web/toonflow/explore/getUploadSignature"): {},
    ("POST", "/web/toonflow/explore/uploadProject"): {},
    ("POST", "/web/toonflow/home/getAdvertisements"): {"banners": [], "bannerMode": "carousel", "bannerInterval": 5, "sidebar": []},
}


@app.api_route("/{full_path:path}", methods=["GET", "POST"])
async def stubs(full_path: str, request: Request):
    path = "/" + full_path
    value = EMPTY_STUBS.get((request.method, path))
    if value is None:
        return fail("接口不存在", 404)
    return ok(value)


init_db()
refresh_models()
# ACT: 上游目录不含图片模型，启动后统一并入，保证图片代理与模型面板一致。
MODELS = catalog_with_images(MODELS)
PRICING = {model["code_name"]: model for model in MODELS}
