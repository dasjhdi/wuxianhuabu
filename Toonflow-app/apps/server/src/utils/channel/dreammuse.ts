import { Toonflow, type ChannelRequestParams } from "./toonflow";

/** 自建渠道基址环境变量，取值形如 https://api.example.com（不含结尾斜杠）。 */
export const DREAMMUSE_API_BASE_ENV = "DREAMMUSE_API_BASE";
/** 渠道选择环境变量，值为 dreammuse 时启用自建渠道。 */
export const DREAMMUSE_CHANNEL_ENV = "DREAMMUSE_CHANNEL";

/**
 * 自建官方统一渠道。
 *
 * 与内置 Toonflow 渠道共用同一套 HTTP 契约：请求路径、Bearer 鉴权方式与
 * `{ code, data, message }` 响应信封完全一致，差异只在基址来源。
 * 因此后端只要按约定实现接口，前端与业务路由无需任何改动。
 *
 * 未配置 DREAMMUSE_API_BASE 时不会静默回落到官方服务器，而是在首次请求时
 * 返回 503 与可执行的修复提示，避免误把数据发往非预期服务。
 */
export class Dreammuse extends Toonflow {
  constructor(baseUrl = process.env[DREAMMUSE_API_BASE_ENV]?.trim() ?? "") {
    super(baseUrl);
  }

  protected override async request<T>(params: ChannelRequestParams): Promise<T> {
    if (!this.baseUrl) {
      throw Object.assign(new Error(`自建渠道未配置：请设置环境变量 ${DREAMMUSE_API_BASE_ENV} 后重启服务`), { status: 503 });
    }
    return super.request<T>(params);
  }
}
