// Dreammuse account provider
const IMAGE_TIMEOUT = 300000;

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
  apiUrl: "http://127.0.0.1:8787/v1",
  protocol: "openai-completions",
  token: "eyJ1aWQiOjEsIm5hbWUiOiJkZW1vIiwiZXhwIjoxNzk2OTgyNjg3fQ==.06365745b2d18f90c4a3f1c5571d31d396fe00aea6633a367c7cf772e3d71949",
  rules: [],
  models: [
    { id: "gpt-image-2", label: "GPT Image 2", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1536", "1536x1024", "2048x2048"], imageRatios: ["1:1", "2:3", "3:2", "16:9", "9:16"] },
    { id: "gpt-image-2.5", label: "GPT Image 2.5", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1536", "1536x1024", "2048x2048"], imageRatios: ["1:1", "2:3", "3:2", "16:9", "9:16"] },
    { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1536", "1536x1024", "2048x2048"], imageRatios: ["1:1", "2:3", "3:2", "16:9", "9:16"] },
    { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1536", "1536x1024", "2048x2048"], imageRatios: ["1:1", "2:3", "3:2", "16:9", "9:16"] },
    { id: "gpt-image-2.6", label: "GPT Image 2.6", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1536", "1536x1024", "2048x2048"], imageRatios: ["1:1", "2:3", "3:2", "16:9", "9:16"] },
    { id: "gpt-image-2.6-flare", label: "GPT Image 2.6 Flare", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1536", "1536x1024", "2048x2048"], imageRatios: ["1:1", "2:3", "3:2", "16:9", "9:16"] },
    { id: "gpt-image-2.6-sunburst", label: "GPT Image 2.6 Sunburst", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1536", "1536x1024", "2048x2048"], imageRatios: ["1:1", "2:3", "3:2", "16:9", "9:16"] },
    { id: "gemini-3-pro-image-preview", label: "Nano Banana Pro（预览）", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9"] },
    { id: "gemini-3-pro-image", label: "Nano Banana Pro", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9"] },
    { id: "gemini-3.1-flash-image-preview", label: "Nano Banana 2（预览）", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9"] },
    { id: "gemini-3.1-flash-image", label: "Nano Banana 2", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9"] },
    { id: "gemini-nano-banana-2.1", label: "Nano Banana 2.1", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9"] }
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
    const response = await this.tool.fetch("http://127.0.0.1:8787/v1" + endpoint, {
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
