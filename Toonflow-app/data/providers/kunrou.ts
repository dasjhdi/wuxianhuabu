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
  | { mediaType: "video"; type: "binary"; data: Uint8Array; mimeType: string };

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
const SUPPORTED_MODELS = new Set(["gemini-omni-1.1-flash", "gemini-veo-3.1-fast"]);
// 实测：多张原始大图（合计约 6 MB）提交时连接会被重置，压到 1280px 后稳定通过。
const MAX_EDGE = 1280;

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

async function pollTask(context: Context, apiKey: string, taskId: string, signal: AbortSignal, referenceHint = false): Promise<MediaAsset[]> {
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
      throw new Error(await readFailure(context, response));
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
      if (!url) throw new Error("任务已完成，但未返回有效的视频地址");
      return [{ mediaType: "video", type: "url", url }];
    }
    if (Date.now() > deadline) throw new Error("视频生成等待超时，任务可能仍在平台执行，请稍后重试");
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

export default {
  id: "kunrou",
  label: "坤柔 AI",
  version: "2.2.0",
  readme: `通过坤柔 AI 的 OpenAI 兼容视频接口生成视频。

- 提交：\`POST /v1/videos\`，返回任务编号
- 查询：\`GET /v1/videos/{id}\`，每 5 秒轮询，\`completed\` 取 \`url\` 或 \`output[].url\`

模型说明：

- **Gemini Veo 3.1 Fast**：支持最多 4 张图片参考，已验证 8 秒 / 720p。
- **Gemini Omni 1.1 Flash**：同样的图片按「图片参考」提交会被平台内容策略拦截；改用首帧方式或去掉人物参考图即可正常生成。

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
          "imageReference:4",
          "videoReference:1",
          "audioReference:1"
        ]
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
    }
  ],
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
    if (!response.ok) throw new Error(await readFailure(this, response));

    const submitted = await response.json() as { id?: unknown; status?: unknown; url?: unknown; output?: unknown; error?: unknown };
    // ACT: 个别模型可能同步返回成片，先尝试直接取地址，避免多余轮询。
    if (typeof submitted?.status === "string" && submitted.status.toLowerCase() === "completed") {
      const direct = typeof submitted.url === "string" ? submitted.url : "";
      if (direct && URL.canParse(direct)) return [{ mediaType: "video", type: "url", url: direct }];
    }
    const taskId = typeof submitted?.id === "string" ? submitted.id.trim() : "";
    if (!taskId) throw new Error("提交任务未返回任务编号");
    await this.saveTaskData?.({ kind: "video", taskId, model: request.model });
    return pollTask(this, apiKey, taskId, signal, references.length > 0);
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
