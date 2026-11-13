import { Toonflow } from "./toonflow";
import { Dreammuse, DREAMMUSE_CHANNEL_ENV } from "./dreammuse";
import type { Channel } from "./types";

const channels = new Map<string, Channel>([["toonflow", new Toonflow()], ["dreammuse", new Dreammuse()]]);

export function getChannel(): Channel {
  const source = process.env[DREAMMUSE_CHANNEL_ENV]?.trim() || process.env.TOONFLOW_CHANNEL?.trim() || "toonflow";
  const channel = channels.get(source);
  if (!channel) throw Object.assign(new Error(`渠道未配置，请检查 ${DREAMMUSE_CHANNEL_ENV} 或 TOONFLOW_CHANNEL`), { status: 503 });
  return channel;
}
