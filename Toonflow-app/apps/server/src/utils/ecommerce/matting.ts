export type MattingProvider = "photoroom" | "removebg" | "custom";

export interface MattingConfig {
  provider: MattingProvider;
  apiKey: string;
  endpoint?: string;
}

export interface MattingResult {
  data: Uint8Array;
  mimeType: string;
  provider: MattingProvider;
}

const DEFAULT_ENDPOINTS: Record<Exclude<MattingProvider, "custom">, string> = {
  photoroom: "https://image-api.photoroom.com/v2/edit",
  removebg: "https://api.remove.bg/v1.0/removebg",
};

function failure(message: string, status = 502) {
  return Object.assign(new Error(message), { status });
}

async function readFailure(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const payload = JSON.parse(text) as { message?: string; errors?: { title?: string; detail?: string }[] };
    return payload.errors?.[0]?.title || payload.errors?.[0]?.detail || payload.message || `抠图服务返回 ${response.status}`;
  } catch {
    return text.slice(0, 200) || `抠图服务返回 ${response.status}`;
  }
}

export async function removeBackground(image: Uint8Array, mimeType: string, config: MattingConfig): Promise<MattingResult> {
  if (!config.apiKey) throw failure("尚未配置抠图服务的 API Key，请在后台「系统设置 → 电商与抠图」中填写", 400);
  const form = new FormData();
  const blob = new Blob([image], { type: mimeType });
  let url: string;
  const headers: Record<string, string> = {};

  if (config.provider === "photoroom") {
    url = config.endpoint?.trim() || DEFAULT_ENDPOINTS.photoroom;
    headers["x-api-key"] = config.apiKey;
    form.append("imageFile", blob, "product.png");
    form.append("removeBackground", "true");
    form.append("format", "png");
  } else if (config.provider === "removebg") {
    url = config.endpoint?.trim() || DEFAULT_ENDPOINTS.removebg;
    headers["X-Api-Key"] = config.apiKey;
    form.append("image_file", blob, "product.png");
    form.append("size", "auto");
    form.append("format", "png");
  } else {
    if (!config.endpoint?.trim()) throw failure("自定义抠图服务需要填写接口地址", 400);
    url = config.endpoint.trim();
    headers.Authorization = `Bearer ${config.apiKey}`;
    form.append("image", blob, "product.png");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { method: "POST", headers, body: form, signal: controller.signal });
    if (!response.ok) throw failure(await readFailure(response), response.status >= 500 ? 502 : 400);
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const payload = await response.json() as { url?: unknown; data?: unknown; image?: unknown };
      const source = [payload.url, payload.data, payload.image].find(value => typeof value === "string") as string | undefined;
      if (!source) throw failure("抠图服务未返回图片数据");
      if (source.startsWith("data:")) {
        const base64 = source.split(",")[1] ?? "";
        return { data: Buffer.from(base64, "base64"), mimeType: "image/png", provider: config.provider };
      }
      const imageResponse = await fetch(source, { signal: controller.signal });
      if (!imageResponse.ok) throw failure("下载抠图结果失败");
      return { data: new Uint8Array(await imageResponse.arrayBuffer()), mimeType: imageResponse.headers.get("content-type") ?? "image/png", provider: config.provider };
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength < 1000) throw failure("抠图服务返回的文件为空");
    return { data, mimeType: type.includes("png") ? "image/png" : "image/png", provider: config.provider };
  } catch (cause) {
    if ((cause as Error)?.name === "AbortError") throw failure("抠图服务超时，请稍后重试");
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
