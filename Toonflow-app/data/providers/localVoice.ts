type MediaAsset = { mediaType: "audio"; type: "base64"; data: string; mimeType: string };

type AudioRequest = { model: string; text?: string; prompt?: string; speed?: number; other?: Record<string, unknown> };
type Context = { config: Record<string, unknown>; signal?: AbortSignal; tool: { fetch: typeof fetch; errorMessage(value: unknown): string } };

const SERVICE = "http://127.0.0.1:8100";
const TIMEOUT = 10 * 60_000;

// 本文件由本地音色服务自动生成：每次上传/删除音色后重写，模型列表即当前音色库。
export default {
  id: "localVoice",
  label: "本地音色克隆",
  version: "1.2.0",
  readme: `音色由本机 CosyVoice2 克隆生成，模型列表即当前音色库。

- 在 http://127.0.0.1:8100 上传参考音频（10–30 秒、单人、无背景音）并填写逐字文本
- 上传后本列表自动更新，选对应角色即可，无需手填 ID
- 参考音频越干净，克隆相似度越高`,
  rules: [],
  models: [
    {
        "id": "demo_nv",
        "label": "测试女声",
        "type": "audio",
        "mode": [
            "text"
        ]
    },
    {
        "id": "凌清研",
        "label": "凌清研",
        "type": "audio",
        "mode": [
            "text"
        ]
    }
],
  async generateAudio(this: Context, request: AudioRequest): Promise<MediaAsset[]> {
    this.signal?.throwIfAborted();
    const text = String(request.text ?? request.prompt ?? "").trim();
    if (!text) throw new Error("请填写待朗读文本");
    const voiceId = String((request.other ?? {}).voiceId ?? "").trim() || request.model;
    if (!voiceId || voiceId === "cosyvoice2") throw new Error("请先在 http://127.0.0.1:8100 上传音色");

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
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail.trim() ? this.tool.errorMessage(detail.trim().slice(0, 200)) : `本地语音服务返回 HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { data?: unknown; mimeType?: unknown };
    if (typeof payload?.data !== "string" || !payload.data) throw new Error("本地语音服务未返回音频");
    return [{ mediaType: "audio", type: "base64", data: payload.data, mimeType: typeof payload.mimeType === "string" ? payload.mimeType : "audio/wav" }];
  },
};
