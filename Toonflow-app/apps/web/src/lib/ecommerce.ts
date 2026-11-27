import http from "@/lib/http";

export interface EcomPreset {
  ratio: string;
  width: number;
  height: number;
  label: string;
}

export interface EcomRecipe {
  id: string;
  label: string;
  description: string;
  background: "white" | "generated";
  presets: EcomPreset[];
}

export interface EcomAsset extends EcomPreset {
  path: string;
  url: string;
  kind?: "video";
  duration?: number;
}

export interface EcomTask {
  id: string;
  type: "image" | "video" | "detail" | "talk" | "batch";
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  recipeId: string;
  outputs: EcomAsset[];
  warnings: string[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EcomConfig {
  matting: { provider: "photoroom" | "removebg" | "custom"; configured: boolean; endpoint: string };
  scene: { providerId?: string; modelId?: string };
  avatar: { provider: "none" | "did" | "custom"; configured: boolean; endpoint: string };
  recipes: EcomRecipe[];
  presets: EcomPreset[];
  canEdit: boolean;
}

export interface EcomModel {
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
  type: string;
  configured?: boolean;
  mode?: string[];
  voices?: { title: string; voice: string }[];
}

export type BatchItemStatus = "pending" | "running" | "succeeded" | "failed";

export interface BatchItem {
  index: number;
  title: string;
  status: BatchItemStatus;
  error: string | null;
  files: { width: number; height: number; path: string }[];
}

export interface BatchHistoryItem {
  id: string;
  status: EcomTask["status"];
  mode: "image" | "video";
  style: "white" | "scene";
  sizes: string[];
  total: number;
  succeeded: number;
  failed: number;
  legacy: boolean;
  createdAt: number;
  updatedAt: number;
  zipUrl: string | null;
  canResume: boolean;
}

export const ecommerceApi = {
  config: () => http<EcomConfig>({ url: "/api/ecommerce/config", method: "GET" }),
  saveConfig: (data: Record<string, unknown>) => http<EcomConfig>({ url: "/api/ecommerce/configSave", method: "PUT", data }),
  models: () => http<EcomModel[]>({ url: "/api/ai/media/models", method: "GET" }),
  createTask: (data: Record<string, unknown>) => http<{ id: string; status: string }>({ url: "/api/ecommerce/tasks", method: "POST", data }),
  createVideo: (data: Record<string, unknown>) => http<{ id: string; status: string }>({ url: "/api/ecommerce/video", method: "POST", data }),
  createDetail: (data: Record<string, unknown>) => http<{ id: string; status: string }>({ url: "/api/ecommerce/detail", method: "POST", data }),
  createTalk: (data: Record<string, unknown>) => http<{ id: string; status: string }>({ url: "/api/ecommerce/talk", method: "POST", data }),
  createBatch: (data: Record<string, unknown>) => http<{ id: string; status: string }>({ url: "/api/ecommerce/batch", method: "POST", data }),
  batchHistory: (page = 1, pageSize = 10) => http<{ items: BatchHistoryItem[]; total: number; page: number; pageSize: number }>({ url: "/api/ecommerce/batchHistory", method: "GET", params: { page, pageSize } }),
  batchItems: (id: string) => http<{ items: BatchItem[] }>({ url: "/api/ecommerce/batchItems", method: "GET", params: { id } }),
  batchResume: (data: { id: string; rows?: number[] }) => http<{ id: string; status: string; rows: number }>({ url: "/api/ecommerce/batchResume", method: "POST", data }),
  testMatting: () => http<{ provider: string; latencyMs: number; bytes: number }>({ url: "/api/ecommerce/testMatting", method: "POST" }),
  status: (id: string) => http<EcomTask>({ url: "/api/ecommerce/status", method: "GET", params: { id } }),
  list: () => http<{ items: EcomTask[] }>({ url: "/api/ecommerce/list", method: "GET" }),
};

export function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

export const statusLabels: Record<EcomTask["status"], string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  partial: "已完成（降级）",
  failed: "失败",
};
