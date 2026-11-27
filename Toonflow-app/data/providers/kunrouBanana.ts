type MediaInput =
  | { type: "url"; url: string; mimeType?: string; name?: string }
  | { type: "base64"; data: string; mimeType: string; name?: string }
  | { type: "binary"; data: Uint8Array; mimeType: string; name?: string };

type MediaAsset =
  | { mediaType: "image"; type: "url"; url: string }
  | { mediaType: "image"; type: "base64"; data: string; mimeType: string }
  | { mediaType: "image"; type: "binary"; data: Uint8Array; mimeType: string };

type ImageRequest = {
  model: string;
  prompt: string;
  images?: MediaInput[];
  mask?: MediaInput;
  n?: number;
  ratio?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  other?: Record<string, unknown>;
};

type ProviderTaskData = { [key: string]: unknown };

type Context = {
  config: Record<string, unknown> & { apiKey?: string };
  signal?: AbortSignal;
  saveTaskData?: (data: ProviderTaskData) => Promise<void>;
  tool: {
    fetch: typeof fetch;
    errorMessage(value: unknown): string;
    media: {
      inspectImage(input: MediaInput): Promise<{ width: number; height: number; format: string }>;
      resizeImage(input: MediaInput, options: { width?: number; height?: number; format?: "jpeg" | "png" | "webp"; quality?: number }): Promise<MediaInput>;
    };
  };
};

// 坤柔 AI「香蕉生图」分组：Gemini Image（Nano Banana）系列。
// 实测（2026-11-27）：该分组模型（gemini-3-pro-image / gemini-3.1-flash-image / gemini-nano-banana-2.1 等）
// 走 gemini_openai 协议，即 POST /v1/chat/completions 对话式生图；/v1/images/* 端点仅支持 imagen 系，
// 对这些模型返回 convert_request_failed。图片以 data URL 内嵌在 choices[0].message.content 中返回。
// 注意：坤柔按 API Key 分组隔离模型，本供应商需填「香蕉生图」分组的 Key；gpt-image 模型请使用「坤柔 AI」供应商。
const API_BASE = "https://api.kunrouai.com/v1";
const IMAGE_MODELS = new Set(["gemini-3-pro-image", "gemini-3-pro-image-default", "gemini-3-pro-image-preview", "gemini-3.1-flash-image", "gemini-3.1-flash-image-preview", "gemini-nano-banana-2.1"]);
// 实测：多张原始大图（合计约 6 MB）提交时连接会被重置，压到 1280px 后稳定通过。
const MAX_EDGE = 1280;
const IMAGE_TIMEOUT = 5 * 60_000;
// 分辨率档位（Gemini Image 官方能力；像素值对对话式生图无意义，统一以档位注入提示词）。
const SIZE_TIERS = new Set(["1k", "2k", "4k"]);
// Nano Banana 系官方支持的画面比例（auto 时由模型自行决定）。
const IMAGE_RATIOS = new Set(["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);

function sniffImageMime(data: Uint8Array): string {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return "image/webp";
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
  return "image/png";
}

async function bytesFromInput(context: Context, input: MediaInput): Promise<{ data: Uint8Array; mimeType: string }> {
  if (input.type === "binary") return { data: input.data, mimeType: input.mimeType || sniffImageMime(input.data) };
  if (input.type === "base64") {
    const data = new Uint8Array(Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ""), "base64"));
    return { data, mimeType: input.mimeType || sniffImageMime(data) };
  }
  const response = await context.tool.fetch(input.url, { signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
  if (!response || !response.ok) throw new Error("参考图下载失败，请重新提供参考图");
  const data = new Uint8Array(await response.arrayBuffer());
  const header = response.headers.get("content-type") ?? "";
  return { data, mimeType: header.startsWith("image/") ? header.split(";")[0]!.trim() : sniffImageMime(data) };
}

function resolveSizeTier(rawSize?: string): string | undefined {
  const size = (rawSize ?? "").trim().toLowerCase();
  if (!size || size === "auto") return undefined;
  return SIZE_TIERS.has(size) ? size.toUpperCase() : undefined;
}

function resolveRatio(rawRatio?: string): string | undefined {
  const ratio = (rawRatio ?? "").trim().toLowerCase();
  if (!ratio || ratio === "auto") return undefined;
  return IMAGE_RATIOS.has(ratio) ? ratio : undefined;
}

async function shrink(context: Context, input: MediaInput): Promise<MediaInput> {
  if (input.type === "url") return input;
  try {
    const info = await context.tool.media.inspectImage(input);
    const longest = Math.max(info.width, info.height);
    if (!Number.isFinite(longest) || longest <= MAX_EDGE) return input;
    const scale = MAX_EDGE / longest;
    return await context.tool.media.resizeImage(input, {
      width: Math.max(1, Math.round(info.width * scale)),
      height: Math.max(1, Math.round(info.height * scale)),
      format: "jpeg",
      quality: 85,
    });
  } catch {
    return input;
  }
}

function toDataUrl(input: { data: Uint8Array; mimeType: string }): string {
  return `data:${input.mimeType};base64,${Buffer.from(input.data).toString("base64")}`;
}

function statusMessage(status: number): string {
  if (status === 401 || status === 403) return "鉴权失败，请检查 API Key 是否有效";
  if (status === 404) return "接口或任务不存在，请确认模型名称与接口地址";
  if (status === 429) return "上游模型繁忙或额度不足，请稍后重试";
  return `接口请求失败，HTTP ${status}`;
}

async function readFailure(context: Context, response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return statusMessage(response.status);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown; code?: unknown } | string; message?: unknown };
    const raw = typeof parsed?.error === "string" ? parsed.error
      : typeof parsed?.error?.message === "string" ? parsed.error.message
        : typeof parsed?.message === "string" ? parsed.message : "";
    // ACT: 高频上游错误翻译为可执行指引，减少用户排查成本。
    if (/可调度账户不足|排队等待/.test(raw)) return "上游模型当前无空闲调度账户（高峰期常见），请稍等片刻后重试。";
    if (/no available channel .* under group|model_not_found/i.test(raw)) {
      return `当前 Key 的分组不包含模型（${raw.slice(0, 120)}）。请确认 Key 属于「香蕉生图」分组，或到坤柔后台确认该分组可用的模型名称。`;
    }
    if (/insufficient_user_quota/i.test(raw)) return "坤柔账户余额不足，请到坤柔后台充值后重试";
    if (raw.trim()) return context.tool.errorMessage(raw.trim());
  } catch {
    const plain = text.trim().slice(0, 300);
    if (plain) return context.tool.errorMessage(plain);
  }
  return statusMessage(response.status);
}

// 从对话式生图返回的 message.content 提取图片：data URL（实测主形态）与 http(s) 图片链接均支持，
// 兼容 markdown 图片语法 ![alt](url) 与纯文本混排。
function extractImageAssets(content: unknown): MediaAsset[] {
  const parts: string[] = [];
  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.text === "string") parts.push(entry.text);
      const inline = entry.image_url as { url?: unknown } | undefined;
      if (inline && typeof inline.url === "string") parts.push(inline.url);
      if (typeof entry.url === "string") parts.push(entry.url);
    }
  }
  const assets: MediaAsset[] = [];
  const seen = new Set<string>();
  const pushAsset = (kind: "url" | "base64", value: string, mimeType: string): void => {
    const key = kind + ":" + value.slice(0, 120);
    if (seen.has(key)) return;
    seen.add(key);
    assets.push(kind === "url"
      ? { mediaType: "image", type: "url", url: value }
      : { mediaType: "image", type: "base64", data: value, mimeType });
  };
  for (const part of parts) {
    for (const match of part.matchAll(/data:(image\/[a-z+.-]+(?:;\s*charset=[\w-]+)?);base64,\s*([A-Za-z0-9+/=\s]+)/gi)) {
      const mime = match[1]!.split(";")[0]!.toLowerCase();
      const data = (match[2] ?? "").replace(/\s+/g, "");
      if (data.length > 256) pushAsset("base64", data, mime);
    }
    for (const match of part.matchAll(/https?:\/\/[^\s"'<>)\]]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>)\]]*)?/gi)) {
      pushAsset("url", match[0], "image/png");
    }
  }
  return assets;
}

export default {
  id: "kunrouBanana",
  label: "坤柔香蕉生图（Nano Banana）",
  version: "1.1.0",
  readme: `通过坤柔 AI（花火市场）「香蕉生图」分组的对话式生图接口调用 Gemini Image（Nano Banana）系列模型。

- 调用方式：\`POST /v1/chat/completions\`（gemini_openai 协议），图片以 data URL 内嵌在回复文本中返回
- 参考图编辑：在消息中附 \`image_url\` 段（data URL），支持多张参考图
- 画面比例与分辨率档位（1K / 2K / 4K）以提示词形式注入，模型按描述出图

注意事项：

- 坤柔按 API Key 分组隔离模型：此处需填「香蕉生图」分组的 Key；GPT Image 系列请使用「坤柔 AI」供应商，两者互不干扰。
- 该分组模型不走 \`/v1/images/*\` 端点（该端点仅支持 imagen 系模型）。
- 高峰期上游可能提示「可调度账户不足」，稍后重试即可。`,
  rules: [
    {
      type: "input",
      field: "apiKey",
      title: "API Key",
      value: "",
      props: { type: "password", showPassword: true, autocomplete: "off" },
    },
  ],
  models: [
    {
      "id": "gemini-3-pro-image",
      "label": "Gemini 3 Pro Image（图生图 / 文生图）",
      "type": "image",
      "imageSizes": ["auto", "1K", "2K", "4K"],
      "imageRatios": ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16", "21:9"]
    },
    {
      "id": "gemini-3-pro-image-default",
      "label": "Gemini 3 Pro Image Default（图生图 / 文生图）",
      "type": "image",
      "imageSizes": ["auto", "1K", "2K", "4K"],
      "imageRatios": ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16", "21:9"]
    },
    {
      "id": "gemini-3-pro-image-preview",
      "label": "Gemini 3 Pro Image Preview（预览版）",
      "type": "image",
      "imageSizes": ["auto", "1K", "2K", "4K"],
      "imageRatios": ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16", "21:9"]
    },
    {
      "id": "gemini-3.1-flash-image",
      "label": "Gemini 3.1 Flash Image（快速 / 低成本）",
      "type": "image",
      "imageSizes": ["auto", "1K", "2K"],
      "imageRatios": ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16", "21:9"]
    },
    {
      "id": "gemini-3.1-flash-image-preview",
      "label": "Gemini 3.1 Flash Image Preview（快速 / 预览版）",
      "type": "image",
      "imageSizes": ["auto", "1K", "2K"],
      "imageRatios": ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16", "21:9"]
    },
    {
      "id": "gemini-nano-banana-2.1",
      "label": "Nano Banana 2.1（文生图）",
      "type": "image",
      "imageSizes": ["auto", "1K", "2K"],
      "imageRatios": ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16", "21:9"]
    }
  ],
  async generateImage(this: Context, request: ImageRequest): Promise<MediaAsset[]> {
    this.signal?.throwIfAborted();
    const apiKey = typeof this.config.apiKey === "string" ? this.config.apiKey.trim() : "";
    if (!apiKey) throw new Error("请填写 API Key");
    if (!IMAGE_MODELS.has(request.model)) throw new Error("不支持的图片模型");
    const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
    if (!prompt) throw new Error("请填写提示词");
    if (request.other && Object.keys(request.other).length) throw new Error("该接口暂无可用的模型专属参数");
    if (request.n !== undefined && (!Number.isInteger(request.n) || request.n < 1 || request.n > 10)) {
      throw new Error("单次生成数量必须是 1 到 10 之间的整数");
    }
    const count = request.n ?? 1;
    // 对话式生图不支持独立参数：比例与分辨率档位以提示词后缀注入，模型按描述出图。
    const ratio = resolveRatio(request.ratio);
    const sizeTier = resolveSizeTier(request.size);
    let fullPrompt = prompt;
    if (ratio) fullPrompt += `\n\n画面比例：${ratio}。`;
    if (sizeTier) fullPrompt += `\n\n输出分辨率：${sizeTier}。`;

    const signal = AbortSignal.any([AbortSignal.timeout(IMAGE_TIMEOUT), ...(this.signal ? [this.signal] : [])]);
    const references: { data: Uint8Array; mimeType: string }[] = [];
    for (const item of request.images ?? []) references.push(await bytesFromInput(this, await shrink(this, item)));
    if (references.length > 10) throw new Error("参考图最多 10 张");
    if (request.mask) {
      // 对话协议无独立遮罩参数：遮罩图附加为最后一张参考图，由模型按说明理解重绘区域。
      references.push(await bytesFromInput(this, request.mask));
      fullPrompt += "\n\n最后一张参考图为重绘区域遮罩示意，请仅在遮罩标示的区域内修改画面，其余区域保持原样。";
    }

    const message: Record<string, unknown> = references.length
      ? {
          role: "user",
          content: [
            { type: "text", text: fullPrompt },
            ...references.map(item => ({ type: "image_url", image_url: { url: toDataUrl(item) } })),
          ],
        }
      : { role: "user", content: fullPrompt };
    const body = JSON.stringify({ model: request.model, messages: [message] });

    const assets: MediaAsset[] = [];
    for (let index = 0; index < count; index++) {
      this.signal?.throwIfAborted();
      let response: Response;
      try {
        response = await this.tool.fetch(`${API_BASE}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error("连接坤柔服务失败，请检查网络后重试");
      }
      if (!response.ok) throw new Error(await readFailure(this, response));
      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const extracted = extractImageAssets(payload.choices?.[0]?.message?.content);
      if (!extracted.length) throw new Error("模型未返回图片内容（可能触发了内容策略或返回了纯文本），请调整提示词后重试");
      assets.push(...extracted);
    }
    return assets;
  },
};
