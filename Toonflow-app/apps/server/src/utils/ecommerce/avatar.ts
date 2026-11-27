export type AvatarProvider = "none" | "did" | "custom";

export interface AvatarConfig {
  provider: AvatarProvider;
  apiKey: string;
  endpoint?: string;
}

export interface AvatarSubmitResult {
  id?: string;
  url?: string;
}

export interface AvatarPollResult {
  status: "pending" | "done" | "failed";
  url?: string;
  error?: string;
}

function failure(message: string, status = 502) {
  return Object.assign(new Error(message), { status });
}

async function readError(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const payload = JSON.parse(text) as { message?: string; description?: string; error?: { message?: string } };
    return payload.error?.message || payload.description || payload.message || `数字人服务返回 ${response.status}`;
  } catch {
    return text.slice(0, 200) || `数字人服务返回 ${response.status}`;
  }
}

function authorization(config: AvatarConfig) {
  return config.provider === "did"
    ? `Basic ${Buffer.from(config.apiKey).toString("base64")}`
    : `Bearer ${config.apiKey}`;
}

async function uploadAsset(url: string, field: string, data: Uint8Array, mimeType: string, config: AvatarConfig) {
  const form = new FormData();
  form.append(field, new Blob([data], { type: mimeType }), field === "image" ? "portrait.png" : "voice.mp3");
  const response = await fetch(url, { method: "POST", headers: { Authorization: authorization(config) }, body: form });
  if (!response.ok) throw failure(await readError(response));
  const payload = await response.json() as { url?: unknown };
  if (typeof payload.url !== "string" || !payload.url) throw failure("数字人服务未返回素材地址");
  return payload.url;
}

export async function submitAvatar(input: {
  image: Uint8Array;
  imageMime: string;
  audio: Uint8Array;
  audioMime: string;
}, config: AvatarConfig): Promise<AvatarSubmitResult> {
  if (!config.apiKey) throw failure("尚未配置数字人服务的 API Key", 400);

  if (config.provider === "did") {
    const imageUrl = await uploadAsset("https://api.d-id.com/images", "image", input.image, input.imageMime, config);
    const audioUrl = await uploadAsset("https://api.d-id.com/audios", "audio", input.audio, input.audioMime, config);
    const response = await fetch("https://api.d-id.com/talks", {
      method: "POST",
      headers: { Authorization: authorization(config), "Content-Type": "application/json" },
      body: JSON.stringify({ source_url: imageUrl, script: { type: "audio", audio_url: audioUrl } }),
    });
    if (!response.ok) throw failure(await readError(response));
    const payload = await response.json() as { id?: unknown };
    if (typeof payload.id !== "string" || !payload.id) throw failure("数字人服务未返回任务编号");
    return { id: payload.id };
  }

  if (!config.endpoint?.trim()) throw failure("自定义数字人服务需要填写接口地址", 400);
  const form = new FormData();
  form.append("image", new Blob([input.image], { type: input.imageMime }), "portrait.png");
  form.append("audio", new Blob([input.audio], { type: input.audioMime }), "voice.mp3");
  const response = await fetch(config.endpoint.trim(), { method: "POST", headers: { Authorization: authorization(config) }, body: form });
  if (!response.ok) throw failure(await readError(response));
  const payload = await response.json() as { id?: unknown; url?: unknown };
  if (typeof payload.url === "string" && payload.url) return { url: payload.url };
  if (typeof payload.id !== "string" || !payload.id) throw failure("自定义数字人服务需返回 id 或 url");
  return { id: payload.id };
}

export async function pollAvatar(id: string, config: AvatarConfig): Promise<AvatarPollResult> {
  const url = config.provider === "did"
    ? `https://api.d-id.com/talks/${encodeURIComponent(id)}`
    : `${config.endpoint?.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
  const response = await fetch(url, { headers: { Authorization: authorization(config) } });
  if (!response.ok) return { status: "failed", error: await readError(response) };
  const payload = await response.json() as { status?: unknown; result_url?: unknown; url?: unknown; error?: unknown };
  const status = String(payload.status ?? "");
  const videoUrl = typeof payload.result_url === "string" ? payload.result_url : typeof payload.url === "string" ? payload.url : undefined;
  if (videoUrl && (!status || status === "done" || status === "completed" || status === "succeeded")) return { status: "done", url: videoUrl };
  if (status === "error" || status === "failed") return { status: "failed", error: typeof payload.error === "string" ? payload.error : "数字人生成失败" };
  return { status: "pending" };
}
