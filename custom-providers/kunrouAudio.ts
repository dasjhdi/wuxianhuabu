type MediaAsset =
  | { mediaType: "audio"; type: "url"; url: string }
  | { mediaType: "audio"; type: "base64"; data: string; mimeType: string };

type AudioRequest = {
  model: string;
  text?: string;
  prompt?: string;
  voice?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  emotion?: string;
  language?: string;
  normalizeText?: boolean;
  format?: string;
  sampleRate?: number;
  other?: Record<string, unknown>;
};

type Context = {
  config: Record<string, unknown> & { apiKey?: string };
  signal?: AbortSignal;
  tool: { fetch: typeof fetch; errorMessage(value: unknown): string };
};

const API_BASE = "https://api.kunrouai.com/v1";
// 语音合成通常 30–60 秒；音乐生成实测可能超过 5 分钟，统一放宽到 15 分钟。
const TIMEOUT = 15 * 60_000;
// 上游音色参数未公开，先按"文本直接朗读"处理；音乐类模型额外支持纯音乐/时长/BPM/歌词。
const MUSIC_MODELS = new Set(["lyria-3.5", "lyria-3-pro", "suno-v6-mini"]);

function readFailure(context: Context, text: string, status: number) {
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
  if (status === 401 || status === 403) return "鉴权失败，请检查 API Key 是否有效";
  if (status === 429) return "请求过于频繁或额度不足，请稍后重试";
  return `接口请求失败，HTTP ${status}`;
}

export default {
  id: "kunrouAudio",
  label: "坤柔音频",
  version: "1.0.0",
  readme: `通过坤柔 AI 的 OpenAI 兼容对话接口生成音频。

- 语音合成：\`gemini-3.8-flash-tts\`、\`grok-voice-latest\`，把待朗读文本直接写进提示词
- 音乐生成：\`lyria-3.5\`、\`lyria-3-pro\`、\`suno-v6-mini\`，提示词描述曲风、乐器、人声与情绪
- 调用：\`POST /v1/chat/completions\`，音频地址在返回的 Markdown 链接中

音频时长与音质由上游模型决定，时长、BPM 等只能作为创作提示。`,
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
    { id: "gemini-3.8-flash-tts", label: "Gemini 3.8 Flash TTS（语音合成）", type: "audio", mode: ["text"] },
    { id: "grok-voice-latest", label: "Grok Voice（语音合成）", type: "audio", mode: ["text"] },
    { id: "lyria-3.5", label: "Lyria 3.5（音乐）", type: "audio", mode: ["text"], rules: [
        { type: "switch", field: "instrumental", title: "纯音乐（无人声）", value: false },
        { type: "textarea", field: "lyrics", title: "歌词（可含 [Verse] / [Chorus] 段落，纯音乐无需填写）", props: { autosize: { minRows: 3, maxRows: 6 }, placeholder: "留空则由模型根据风格描述创作" } },
        { type: "inputNumber", field: "duration", title: "时长（秒）—— 实测上游按整首生成，此值仅作参考", props: { min: 5, max: 240, step: 5, placeholder: "留空由模型决定" } },
      ] },
    { id: "lyria-3-pro", label: "Lyria 3 Pro（音乐）", type: "audio", mode: ["text"], rules: [
        { type: "switch", field: "instrumental", title: "纯音乐（无人声）", value: false },
        { type: "textarea", field: "lyrics", title: "歌词（可含 [Verse] / [Chorus] 段落，纯音乐无需填写）", props: { autosize: { minRows: 3, maxRows: 6 }, placeholder: "留空则由模型根据风格描述创作" } },
        { type: "inputNumber", field: "duration", title: "时长（秒）—— 实测上游按整首生成，此值仅作参考", props: { min: 5, max: 240, step: 5, placeholder: "留空由模型决定" } },
      ] },
    { id: "suno-v6-mini", label: "Suno V6 Mini（歌曲）", type: "audio", mode: ["text"], rules: [
        { type: "switch", field: "instrumental", title: "纯音乐（无人声）", value: false },
        { type: "textarea", field: "lyrics", title: "歌词（可含 [Verse] / [Chorus] 段落，纯音乐无需填写）", props: { autosize: { minRows: 3, maxRows: 6 }, placeholder: "留空则由模型根据风格描述创作" } },
        { type: "inputNumber", field: "duration", title: "时长（秒）—— 实测上游按整首生成，此值仅作参考", props: { min: 5, max: 240, step: 5, placeholder: "留空由模型决定" } },
      ] },
  ],
  async generateAudio(this: Context, request: AudioRequest): Promise<MediaAsset[]> {
    this.signal?.throwIfAborted();
    const apiKey = typeof this.config.apiKey === "string" ? this.config.apiKey.trim() : "";
    if (!apiKey) throw new Error("请填写 API Key");

    const prompt = String(request.text ?? request.prompt ?? "").trim();
    if (!prompt) throw new Error("请填写待朗读文本或音频描述");

    const body: Record<string, unknown> = {
      model: request.model,
      messages: [{ role: "user", content: prompt }],
      n: 1,
      stream: false,
    };

    if (MUSIC_MODELS.has(request.model)) {
      const other = request.other ?? {};
      if (typeof other.instrumental === "boolean") body.instrumental = other.instrumental;
      if (typeof other.lyrics === "string" && other.lyrics.trim()) body.lyrics = other.lyrics;
      const duration = Number(other.duration);
      if (Number.isFinite(duration) && duration > 0) body.duration = Math.round(duration);
      const bpm = Number(other.bpm);
      if (Number.isFinite(bpm) && bpm > 0) body.bpm = Math.round(bpm);
      if (request.format && ["mp3", "wav", "m4a"].includes(request.format)) body.audio_format = request.format;
    }

    const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT), ...(this.signal ? [this.signal] : [])]);
    let response: Response;
    try {
      response = await this.tool.fetch(`${API_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new Error("任务已取消或等待超时");
      throw new Error(`提交任务失败：${error instanceof Error ? error.message : String(error)}`);
    }

    const text = await response.text();
    if (!response.ok) throw new Error(readFailure(this, text, response.status));

    let payload: {
      choices?: { message?: { content?: unknown } }[];
      data?: { url?: unknown }[];
    };
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("上游返回内容不是合法 JSON");
    }

    const urls: string[] = [];
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      // ACT: gemini 返回 [生成音频](https://…)，grok 返回 ](<https://…>)，统一剔除尖括号与尾部标点。
      for (const match of content.match(/https?:\/\/[^\s)\]>、"']+/g) ?? []) urls.push(match.replace(/[.,;]+$/, ""));
    }
    for (const item of payload?.data ?? []) {
      if (typeof item?.url === "string" && item.url) urls.push(item.url);
    }
    const unique = [...new Set(urls)].filter(url => URL.canParse(url));
    if (!unique.length) throw new Error("上游未返回音频地址");
    return unique.map(url => ({ mediaType: "audio" as const, type: "url" as const, url }));
  },
};
