/**
 * 官方统一渠道地址的唯一来源。
 *
 * 前端外链（账号、插件市场、预览）与服务端请求（登录、余额、插件、更新、遥测）
 * 都从这里取值。接入自有渠道时只改这一处常量，前端与服务端同时生效。
 */
export const OFFICIAL_API_BASE = "https://api.toonflow.net";

/** 拼接官方渠道地址；path 需以 / 开头。 */
export function officialApiUrl(path: string) {
  return `${OFFICIAL_API_BASE}${path}`;
}
