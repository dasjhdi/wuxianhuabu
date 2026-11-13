type MediaAsset = { mediaType: "audio"; type: "base64"; data: string; mimeType: string };

type AudioRequest = {
  model: string;
  text?: string;
  prompt?: string;
  speed?: number;
  format?: string;
  other?: Record<string, unknown>;
};

type Context = {
  config: Record<string, unknown>;
  signal?: AbortSignal;
  tool: { fetch: typeof fetch; errorMessage(value: unknown): string };
};

const SERVICE = "http://127.0.0.1:8100";
const TIMEOUT = 10 * 60_000;

async function readFailure(context: Context, response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
    const detail = typeof parsed?.detail === "string" ? parsed.detail : typeof parsed?.message === "string" ? parsed.message : "";
    if (detail.trim()) return context.tool.errorMessage(detail.trim());
  } catch {
    if (text.trim()) return context.tool.errorMessage(text.trim().slice(0, 300));
  }
  return `本地语音服务返回 HTTP ${response.status}`;
}

export default {
  id: "localVoice",
  label: "本地音色克隆",
  version: "1.0.0",
  readme: `调用本机 CosyVoice2 服务做零样本音色克隆。

- 每个角色在 \`voices/<音色ID>/ref.wav\` 放一段 3–30 秒参考音频，并在 \`prompt.txt\` 写逐字转写文本
- 在节点里填写「音色 ID」即可复刻该音色，所有台词保持同一音色
- 参考音频越干净（单人、无背景音乐、无混响），克隆相似度越高

服务地址 http://127.0.0.1:8100，需先启动 CosyVoice/server_local.py。`,
  rules: [
    {
      type: "input",
      field: "voiceId",
      title: "音色 ID",
      value: "",
      props: { placeholder: "例如 lingqingyan / 凌清砚" },
    },
  ],
  models: [
    { id: "cosyvoice2", label: "CosyVoice2 克隆（填写音色 ID）", type: "audio", mode: ["text"] },
  ],
  async generateAudio(this: Context, request: AudioRequest): Promise<MediaAsset[]> {
    this.signal?.throwIfAborted();
    const text = String(request.text ?? request.prompt ?? "").trim();
    if (!text) throw new Error("请填写待朗读文本");
    // ACT: 允许两种用法——节点里填「音色 ID」，或直接把音色 ID 当模型名使用。
    const voiceId = String((request.other ?? {}).voiceId ?? "").trim()
      || (request.model !== "cosyvoice2" ? request.model : "");
    if (!voiceId) throw new Error("请在「音色 ID」中填写已注册的音色");

    const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT), ...(this.signal ? [this.signal] : [])]);
    let response: Response;
    try {
      response = await this.tool.fetch(`${SERVICE}/tts/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId, speed: request.speed ?? 1 }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new Error("任务已取消或等待超时");
      throw new Error(`本地语音服务不可达：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(await readFailure(this, response));
    const payload = (await response.json()) as { data?: unknown; mimeType?: unknown };
    if (typeof payload?.data !== "string" || !payload.data) throw new Error("本地语音服务未返回音频");
    return [{ mediaType: "audio", type: "base64", data: payload.data, mimeType: typeof payload.mimeType === "string" ? payload.mimeType : "audio/wav" }];
  },
};
