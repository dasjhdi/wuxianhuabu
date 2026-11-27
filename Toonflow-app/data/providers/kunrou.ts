type MediaInput =
  | { type: "url"; url: string; mimeType?: string; name?: string }
  | { type: "base64"; data: string; mimeType: string; name?: string }
  | { type: "binary"; data: Uint8Array; mimeType: string; name?: string };

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | string[];

type VideoRequest = {
  model: string;
  prompt: string;
  mode?: VideoMode;
  images?: MediaInput[];
  videos?: MediaInput[];
  audios?: MediaInput[];
  firstFrame?: MediaInput;
  lastFrame?: MediaInput;
  duration?: number;
  ratio?: string;
  resolution?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  other?: Record<string, unknown>;
};

type MediaAsset =
  | { mediaType: "video"; type: "url"; url: string }
  | { mediaType: "video"; type: "base64"; data: string; mimeType: string }
  | { mediaType: "video"; type: "binary"; data: Uint8Array; mimeType: string }
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

const API_BASE = "https://api.kunrouai.com/v1";
const POLL_INTERVAL = 5000;
const POLL_TIMEOUT = 15 * 60_000;
const SUPPORTED_MODELS = new Set(["gemini-omni-1.1-flash", "gemini-omni-1.1-flash-f", "gemini-omni-1.2-flash-v", "gemini-omni-1.2-flash-a", "gemini-omni-1.2-flash-f", "gemini-veo-3.1-fast", "gemini-veo-3.1-lite", "grok-imagine-video-1.5"]);
const IMAGE_MODELS = new Set(["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2.6", "gpt-image-2.6-sunburst", "gpt-image-2.6-flare"]);
// 实测：多张原始大图（合计约 6 MB）提交时连接会被重置，压到 1280px 后稳定通过。
const MAX_EDGE = 1280;
const IMAGE_TIMEOUT = 5 * 60_000;

// 实测（2026-11-26）：/v1/images/generations 同步返回 {data:[{b64_json}], output_format:"png"}，约 22s；
// /v1/images/edits 支持 image[] 多张参考图（multipart），约 37s。接口契约与 OpenAI Images API 一致。
// 官方文档：size 支持宽×高像素（如 1024x1536）或档位（1K / 2K / 4K）。
const IMAGE_SIZES = new Set(["auto", "1024x1024", "1536x1024", "1024x1536", "1k", "2k", "4k"]);

function sniffImageMime(data: Uint8Array): string {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return "image/webp";
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
  return "image/png";
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

// ACT: VM 沙箱没有 FormData，参考图编辑的 multipart 请求体手动拼装（Blob 之外仅有 Uint8Array 可用）。
class MultipartBody {
  readonly boundary: string;
  private chunks: Uint8Array[] = [];

  constructor(boundary: string) {
    this.boundary = boundary;
  }

  private pushText(value: string): void {
    this.chunks.push(new TextEncoder().encode(value));
  }

  appendField(name: string, value: string): void {
    this.pushText("--" + this.boundary + "\r\n");
    this.pushText(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    this.pushText(value + "\r\n");
  }

  appendFile(name: string, filename: string, mimeType: string, data: Uint8Array): void {
    this.pushText("--" + this.boundary + "\r\n");
    this.pushText(`Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`);
    this.pushText("Content-Type: " + mimeType + "\r\n\r\n");
    this.chunks.push(data);
    this.pushText("\r\n");
  }

  finish(): Uint8Array {
    this.pushText("--" + this.boundary + "--\r\n");
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return body;
  }
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

function resolveImageSize(rawSize?: string): string | undefined {
  const size = (rawSize ?? "").trim().toLowerCase();
  if (!size || size === "auto") return undefined;
  return IMAGE_SIZES.has(size) ? size : undefined;
}

async function collectImageAssets(payload: { data?: unknown; output_format?: unknown }): Promise<MediaAsset[]> {
  const items = Array.isArray(payload.data) ? payload.data : [];
  const fallbackMime = typeof payload.output_format === "string" && payload.output_format.trim()
    ? `image/${payload.output_format.trim().toLowerCase().replace("jpg", "jpeg")}` : "image/png";
  const assets: MediaAsset[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const url = typeof entry.url === "string" && entry.url.trim() && URL.canParse(entry.url.trim()) ? entry.url.trim() : "";
    if (url && /^https?:/i.test(new URL(url).protocol)) {
      assets.push({ mediaType: "image", type: "url", url });
      continue;
    }
    const base64 = typeof entry.b64_json === "string" ? entry.b64_json
      : typeof entry.b64 === "string" ? entry.b64
      : typeof entry.base64 === "string" ? entry.base64 : "";
    const payloadPart = base64.replace(/^data:[^;]+;base64,/, "").trim();
    if (payloadPart) {
      const data = new Uint8Array(Buffer.from(payloadPart, "base64"));
      assets.push({ mediaType: "image", type: "base64", data: Buffer.from(data).toString("base64"), mimeType: sniffImageMime(data) || fallbackMime });
    }
  }
  if (!assets.length) throw new Error("接口未返回有效的图片结果，请重试");
  return assets;
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

function toReference(input: MediaInput): string {
  if (input.type === "url") return input.url;
  if (input.type === "base64") return `data:${input.mimeType};base64,${input.data}`;
  return `data:${input.mimeType};base64,${Buffer.from(input.data).toString("base64")}`;
}

function statusMessage(status: number): string {
  if (status === 401 || status === 403) return "鉴权失败，请检查 API Key 是否有效";
  if (status === 404) return "接口或任务不存在，请确认模型名称与接口地址";
  if (status === 429) return "请求过于频繁或额度不足，请稍后重试";
  return `接口请求失败，HTTP ${status}`;
}

async function readFailure(context: Context, response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return statusMessage(response.status);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const detail = typeof parsed?.error === "string" ? parsed.error
      : typeof parsed?.error?.message === "string" ? parsed.error.message
        : typeof parsed?.message === "string" ? parsed.message : "";
    if (detail.trim()) return context.tool.errorMessage(detail.trim());
  } catch {
    const plain = text.trim().slice(0, 300);
    if (plain) return context.tool.errorMessage(plain);
  }
  return statusMessage(response.status);
}

// ACT: 高频上游错误翻译为可执行指引，减少用户排查成本。
function translateUpstreamError(message: string, imageCount = 0, model = ""): string {
  if (/insufficient_user_quota/i.test(message)) return "坤柔账户余额不足，请到坤柔后台充值后重试";
  if (/生成服务暂时不可用|service_unavailable/i.test(message)) return "上游服务偶发不可用，请等 1 分钟后用相同参数直接重试";
  if (/请求参数不合法/.test(message) && imageCount > 2 && model.startsWith("gemini-omni")) {
    return `${message}（提示：已提交 ${imageCount} 张参考图，Omni 系模型最多 2 张，请减少参考图后重试）`;
  }
  return message;
}

async function pollTask(context: Context, apiKey: string, taskId: string, signal: AbortSignal, referenceHint = false, imageCount = 0, model = ""): Promise<MediaAsset[]> {
  const deadline = Date.now() + POLL_TIMEOUT;
  while (true) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await context.tool.fetch(`${API_BASE}/videos/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (Date.now() > deadline) throw new Error("视频生成等待超时，任务可能仍在平台执行，请稍后重试");
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      continue;
    }
    if (!response.ok) {
      if (response.status >= 500 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }
      throw new Error(translateUpstreamError(await readFailure(context, response), imageCount, model));
    }
    const payload = await response.json() as {
      status?: unknown; progress?: unknown; url?: unknown; output?: unknown; error?: unknown;
    };
    const status = typeof payload?.status === "string" ? payload.status.toLowerCase() : "";
    if (status === "failed") {
      const error = payload?.error as { message?: unknown; code?: unknown } | string | undefined;
      const detail = typeof error === "string" ? error : error?.message;
      const errorCode = typeof error === "object" && error ? error.code : undefined;
      let message = typeof detail === "string" && detail.trim() ? context.tool.errorMessage(detail) : "视频生成失败";
      message = translateUpstreamError(message, imageCount, model);
      // 实测：该平台会拦截「图片参考」方式携带的人物素材，而同样的图片按首帧提交可以正常生成。
      if (errorCode === "content_policy_violation" && referenceHint) {
        message += "（该平台拦截了图片参考素材。可把节点模式改为「尾帧可选」，让图片以首帧方式提交；或去掉人物参考图后重试。）";
      }
      throw Object.assign(new Error(message), { code: "MEDIA_TASK_FAILED" });
    }
    if (status === "completed") {
      const output = Array.isArray(payload?.output) ? payload.output : [];
      const candidates = [
        typeof payload?.url === "string" ? payload.url : "",
        ...output.map(item => (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string" ? (item as { url: string }).url : "")),
      ].filter(value => !!value);
      const url = candidates.find(value => URL.canParse(value) && ["https:", "http:"].includes(new URL(value).protocol));
      if (!url) throw new Error(model.startsWith("grok-imagine") ? "任务已完成，但未返回视频地址（Grok 偶发问题，请直接重试一次）" : "任务已完成，但未返回有效的视频地址");
      return [{ mediaType: "video", type: "url", url }];
    }
    if (Date.now() > deadline) throw new Error("视频生成等待超时，任务可能仍在平台执行，请稍后重试");
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

export default {
  id: "kunrou",
  label: "坤柔 AI",
  version: "2.5.0",
  readme: `通过坤柔 AI（花火市场）的 OpenAI 兼容接口生成视频与图片。

- 视频：\`POST /v1/videos\`，返回任务编号；\`GET /v1/videos/{id}\` 每 5 秒轮询，\`completed\` 取 \`url\` 或 \`output[].url\`
- 图片：\`POST /v1/images/generations\`（文生图，同步返回 \`b64_json\`）；带参考图时走 \`POST /v1/images/edits\`（multipart，\`image\`/\`image[]\` 字段，支持多张参考图）

注意事项：

- 图片模型（GPT Image 2/2.5/2.6 系列）与视频模型可能分属不同 API Key 分组；若提示无可用渠道或模型不存在，请确认所用 Key 的分组包含对应模型。
- 视频：**Gemini Veo 3.1 Fast** 支持最多 4 张图片参考；**Gemini Omni 1.1 Flash** 的图片按「图片参考」提交会被平台内容策略拦截，改用首帧方式或去掉人物参考图即可正常生成。

时长与分辨率以所选模型支持的档位为准，未指定时使用平台默认值。`,
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
      "id": "gemini-omni-1.1-flash",
      "label": "Gemini Omni 1.1 Flash",
      "type": "video",
      "durationResolutionMap": [
        {
          "duration": [
            4,
            5,
            6,
            8
          ],
          "resolution": [
            "720p"
          ]
        }
      ],
      "mode": [
        "text",
        "singleImage",
        "startFrameOptional",
        "endFrameOptional",
        "startEndRequired",
        [
          "imageReference:2",
          "videoReference:1",
          "audioReference:1"
        ]
      ]
    },
    {
      "id": "gemini-omni-1.2-flash-v",
      "label": "Gemini Omni 1.2 Flash（4/5/8/10 秒）",
      "type": "video",
      "durationResolutionMap": [
        {
          "duration": [
            4,
            5,
            8,
            10
          ],
          "resolution": [
            "720p"
          ]
        }
      ],
      "mode": [
        "text",
        "singleImage"
      ]
    },
    {
      "id": "gemini-veo-3.1-fast",
      "label": "Gemini Veo 3.1 Fast",
      "type": "video",
      "durationResolutionMap": [
        {
          "duration": [
            8
          ],
          "resolution": [
            "720p"
          ]
        }
      ],
      "mode": [
        "text",
        [
          "imageReference:4"
        ]
      ]
    },
    {
      "id": "gemini-veo-3.1-lite",
      "label": "Gemini Veo 3.1 Lite（8 秒，低成本）",
      "type": "video",
      "durationResolutionMap": [
        {
          "duration": [
            8
          ],
          "resolution": [
            "720p"
          ]
        }
      ],
      "mode": [
        "text",
        [
          "imageReference:4"
        ]
      ]
    },
    {
      "id": "gemini-omni-1.2-flash-a",
      "label": "Gemini Omni 1.2 Flash A（4/5/8/10 秒，带音频）",
      "type": "video",
      "durationResolutionMap": [
        {
          "duration": [
            4,
            5,
            8,
            10
          ],
          "resolution": [
            "720p"
          ]
        }
      ],
      "mode": [
        "text",
        "singleImage"
      ]
    },
    {
      "id": "gemini-omni-1.2-flash-f",
      "label": "Gemini Omni 1.2 Flash F（4/5/8/10 秒）",
      "type": "video",
      "durationResolutionMap": [
        {
          "duration": [
            4,
            5,
            8,
            10
          ],
          "resolution": [
            "720p"
          ]
        }
      ],
      "mode": [
        "text",
        "singleImage"
      ]
    },
    {
      "id": "gemini-omni-1.1-flash-f",
      "label": "Gemini Omni 1.1 Flash F（4/6/8/10 秒）",
      "type": "video",
      "durationResolutionMap": [
        {
          "duration": [
            4,
            6,
            8,
            10
          ],
          "resolution": [
            "720p"
          ]
        }
      ],
      "mode": [
        "text",
        "singleImage",
        [
          "imageReference:2"
        ]
      ]
    },
    {
      "id": "grok-imagine-video-1.5",
      "label": "Grok Imagine Video 1.5（5/10 秒）",
      "type": "video",
      "durationResolutionMap": [
        {
          "duration": [
            5,
            10
          ],
          "resolution": [
            "720p"
          ]
        }
      ],
      "mode": [
        "text"
      ]
    },
    {
      "id": "gpt-image-2",
      "label": "GPT Image 2（文生图 / 图片编辑）",
      "type": "image",
      "imageSizes": ["1024x1024", "1536x1024", "1024x1536", "2K"],
      "imageRatios": ["21:9", "16:9", "3:2", "1:1", "3:4", "9:16"]
    },
    {
      "id": "gpt-image-2.5",
      "label": "GPT Image 2.5（文生图 / 图片编辑）",
      "type": "image",
      "imageSizes": ["1024x1024", "1536x1024", "1024x1536", "2K"],
      "imageRatios": ["21:9", "16:9", "3:2", "1:1", "3:4", "9:16"]
    },
    {
      "id": "gpt-image-2.5-sunburst",
      "label": "GPT Image 2.5 Sunburst（文生图 / 图片编辑）",
      "type": "image",
      "imageSizes": ["1024x1024", "1536x1024", "1024x1536", "2K"],
      "imageRatios": ["21:9", "16:9", "3:2", "1:1", "3:4", "9:16"]
    },
    {
      "id": "gpt-image-2.5-flare",
      "label": "GPT Image 2.5 Flare（文生图 / 图片编辑）",
      "type": "image",
      "imageSizes": ["1024x1024", "1536x1024", "1024x1536", "2K"],
      "imageRatios": ["21:9", "16:9", "3:2", "1:1", "3:4", "9:16"]
    },
    {
      "id": "gpt-image-2.6",
      "label": "GPT Image 2.6（文生图 / 图片编辑）",
      "type": "image",
      "imageSizes": ["1024x1024", "1536x1024", "1024x1536", "2K"],
      "imageRatios": ["21:9", "16:9", "3:2", "1:1", "3:4", "9:16"]
    },
    {
      "id": "gpt-image-2.6-sunburst",
      "label": "GPT Image 2.6 Sunburst（文生图 / 图片编辑）",
      "type": "image",
      "imageSizes": ["1024x1024", "1536x1024", "1024x1536", "2K"],
      "imageRatios": ["21:9", "16:9", "3:2", "1:1", "3:4", "9:16"]
    },
    {
      "id": "gpt-image-2.6-flare",
      "label": "GPT Image 2.6 Flare（文生图 / 图片编辑）",
      "type": "image",
      "imageSizes": ["1024x1024", "1536x1024", "1024x1536", "2K"],
      "imageRatios": ["21:9", "16:9", "3:2", "1:1", "3:4", "9:16"]
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
    const size = resolveImageSize(request.size);
    // 画面比例（如 16:9）。官方文档：ratio 优先于 aspect_ratio 和 size，与 size 同时设置时以 ratio 为准。
    const ratio = /^\d{1,4}:\d{1,4}$/.test((request.ratio ?? "").trim()) ? request.ratio!.trim() : undefined;
    if (request.n !== undefined && (!Number.isInteger(request.n) || request.n < 1 || request.n > 10)) {
      throw new Error("单次生成数量必须是 1 到 10 之间的整数");
    }

    const fields: Array<[string, string]> = [["model", request.model], ["prompt", prompt]];
    if (request.n !== undefined) fields.push(["n", String(request.n)]);
    if (size) fields.push(["size", size]);
    if (ratio) fields.push(["ratio", ratio]);

    const signal = AbortSignal.any([AbortSignal.timeout(IMAGE_TIMEOUT), ...(this.signal ? [this.signal] : [])]);
    const references: { data: Uint8Array; mimeType: string }[] = [];
    for (const item of request.images ?? []) references.push(await bytesFromInput(this, await shrink(this, item)));
    if (references.length > 10) throw new Error("参考图最多 10 张");
    const mask = request.mask ? await bytesFromInput(this, request.mask) : undefined;
    if (mask && !references.length) throw new Error("遮罩需要配合至少一张参考图一起使用");

    let response: Response;
    if (references.length) {
      // 带参考图：OpenAI Images 编辑接口（multipart）。单图用 image 字段，多图用 image[] 重复字段。
      const body = new MultipartBody("----kunrou" + Date.now().toString(16) + Math.random().toString(16).slice(2, 10));
      if (references.length === 1) {
        const only = references[0]!;
        body.appendFile("image", "reference." + extensionFor(only.mimeType), only.mimeType, only.data);
      } else {
        for (const [index, item] of references.entries()) {
          body.appendFile("image[]", `reference-${index + 1}.` + extensionFor(item.mimeType), item.mimeType, item.data);
        }
      }
      if (mask) body.appendFile("mask", "mask." + extensionFor(mask.mimeType), mask.mimeType, mask.data);
      for (const field of fields) body.appendField(field[0], field[1]);
      response = await this.tool.fetch(`${API_BASE}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": `multipart/form-data; boundary=${body.boundary}` },
        body: body.finish(),
        signal,
      });
    } else {
      response = await this.tool.fetch(`${API_BASE}/images/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(fields)),
        signal,
      });
    }
    if (!response.ok) throw new Error(translateUpstreamError(await readFailure(this, response)));
    return collectImageAssets(await response.json() as { data?: unknown; output_format?: unknown });
  },
  async generateVideo(this: Context, request: VideoRequest): Promise<MediaAsset[]> {
    this.signal?.throwIfAborted();
    const apiKey = typeof this.config.apiKey === "string" ? this.config.apiKey.trim() : "";
    if (!apiKey) throw new Error("请填写 API Key");
    if (!SUPPORTED_MODELS.has(request.model)) throw new Error("不支持的模型");
    if (typeof request.prompt !== "string" || !request.prompt.trim()) throw new Error("请填写提示词");
    if (request.generateAudio === true) throw new Error("该接口不支持单独指定是否生成音频");
    if (request.watermark === true) throw new Error("该接口不支持水印开关");
    if (request.other && Object.keys(request.other).length) throw new Error("该接口暂无可用的模型专属参数");
    if (request.duration !== undefined && (!Number.isInteger(request.duration) || request.duration < 1 || request.duration > 60)) {
      throw new Error("时长必须是 1 至 60 之间的整数秒");
    }

    const body: Record<string, unknown> = { model: request.model, prompt: request.prompt.trim() };
    if (request.duration !== undefined) body.duration = request.duration;
    if (request.resolution) body.resolution = request.resolution;
    if (request.ratio) body.aspect_ratio = request.ratio;

    const frames: Record<string, string>[] = [];
    if (request.firstFrame) frames.push({ url: toReference(await shrink(this, request.firstFrame)), role: "first_frame" });
    if (request.lastFrame) frames.push({ url: toReference(await shrink(this, request.lastFrame)), role: "last_frame" });
    const references: Record<string, string>[] = [];
    for (const item of request.images ?? []) references.push({ url: toReference(await shrink(this, item)), role: "reference" });
    const images = [...frames, ...references];
    if (images.length) body.reference_images = images;
    if (request.audios?.length) body.reference_audios = request.audios.map(toReference);
    if (request.videos?.length) body.reference_videos = request.videos.map(toReference);

    const signal = AbortSignal.any([AbortSignal.timeout(POLL_TIMEOUT), ...(this.signal ? [this.signal] : [])]);
    let response: Response;
    try {
      response = await this.tool.fetch(`${API_BASE}/videos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new Error("任务已取消或等待超时");
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`提交任务失败：${detail}`);
    }
    if (!response.ok) throw new Error(translateUpstreamError(await readFailure(this, response), images.length, request.model));

    const submitted = await response.json() as { id?: unknown; status?: unknown; url?: unknown; output?: unknown; error?: unknown };
    // ACT: 个别模型可能同步返回成片，先尝试直接取地址，避免多余轮询。
    if (typeof submitted?.status === "string" && submitted.status.toLowerCase() === "completed") {
      const direct = typeof submitted.url === "string" ? submitted.url : "";
      if (direct && URL.canParse(direct)) return [{ mediaType: "video", type: "url", url: direct }];
    }
    const taskId = typeof submitted?.id === "string" ? submitted.id.trim() : "";
    if (!taskId) throw new Error("提交任务未返回任务编号");
    await this.saveTaskData?.({ kind: "video", taskId, model: request.model });
    return pollTask(this, apiKey, taskId, signal, references.length > 0, images.length, request.model);
  },
  async resumeTask(this: Context, data: ProviderTaskData): Promise<MediaAsset[]> {
    const apiKey = typeof this.config.apiKey === "string" ? this.config.apiKey.trim() : "";
    if (!apiKey) throw new Error("请填写 API Key");
    if (data?.kind !== "video" || typeof data.taskId !== "string" || !data.taskId.trim()
      || data.model !== "gemini-omni-1.1-flash" && data.model !== "gemini-veo-3.1-fast") {
      throw new Error("任务恢复数据无效，请重新发起生成");
    }
    const signal = AbortSignal.any([AbortSignal.timeout(POLL_TIMEOUT), ...(this.signal ? [this.signal] : [])]);
    return pollTask(this, apiKey, data.taskId.trim(), signal);
  },
};
