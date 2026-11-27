import type { LightingSettings } from "./scene";

export interface LightingPreset {
  name: string;
  swatch: string;
  /** 相对“摄影机背后”方向的方位偏移（度）：0 = 顺光，180 = 逆光。 */
  offset: number;
  patch: Omit<Partial<LightingSettings>, "azimuth">;
}

// ACT: 光位以当前机位为基准描述（顺光 / 侧光 / 逆光），切换机位后同一预设仍符合摄影习惯。
export const lightingPresets: LightingPreset[] = [
  { name: "正午", swatch: "#fff3cf", offset: 180, patch: { elevation: 65, color: "#fff4d6", intensity: 3.2, sunEnabled: true, globalEnabled: true, globalIntensity: 0.9 } },
  { name: "清晨", swatch: "#ffd9a8", offset: 135, patch: { elevation: 16, color: "#ffd9a8", intensity: 2.4, sunEnabled: true, globalEnabled: true, globalIntensity: 0.7 } },
  { name: "黄昏", swatch: "#ffb070", offset: 150, patch: { elevation: 8, color: "#ffb070", intensity: 2.6, sunEnabled: true, globalEnabled: true, globalIntensity: 0.6 } },
  { name: "暮色", swatch: "#8fa3ff", offset: 120, patch: { elevation: 4, color: "#8fa3ff", intensity: 1.2, sunEnabled: true, globalEnabled: true, globalIntensity: 0.4 } },
  { name: "阴天", swatch: "#dfe8ff", offset: 180, patch: { elevation: 60, color: "#dfe8ff", intensity: 0.8, sunEnabled: true, globalEnabled: true, globalIntensity: 1.3 } },
  { name: "伦勃朗", swatch: "#ffe2b8", offset: 135, patch: { elevation: 45, color: "#ffe2b8", intensity: 3.4, sunEnabled: true, globalEnabled: true, globalIntensity: 0.35 } },
  { name: "蝶形光", swatch: "#fff0e2", offset: 180, patch: { elevation: 55, color: "#fff0e2", intensity: 3, sunEnabled: true, globalEnabled: true, globalIntensity: 0.4 } },
  { name: "轮廓光", swatch: "#cfe6ff", offset: 20, patch: { elevation: 26, color: "#cfe6ff", intensity: 3.8, sunEnabled: true, globalEnabled: true, globalIntensity: 0.5 } },
  { name: "侧光", swatch: "#ffe9c9", offset: 90, patch: { elevation: 25, color: "#ffe9c9", intensity: 3, sunEnabled: true, globalEnabled: true, globalIntensity: 0.45 } },
  { name: "追光", swatch: "#ffffff", offset: 170, patch: { elevation: 82, color: "#ffffff", intensity: 4.6, sunEnabled: true, globalEnabled: true, globalIntensity: 0.25 } },
];

/** 8 个方位 × 3 个高度 = 24 个主光位。 */
export const lightDirections = [
  { label: "前", offset: 0 }, { label: "右前", offset: 45 }, { label: "右", offset: 90 }, { label: "右后", offset: 135 },
  { label: "后", offset: 180 }, { label: "左后", offset: 225 }, { label: "左", offset: 270 }, { label: "左前", offset: 315 },
] as const;
export const lightHeights = [
  { key: "low", label: "低", elevation: 12 },
  { key: "mid", label: "中", elevation: 35 },
  { key: "high", label: "高", elevation: 60 },
] as const;

export const colorTemperatures = [
  { label: "2700K", color: "#ffb46b" },
  { label: "4000K", color: "#ffd3a0" },
  { label: "5600K", color: "#fff1dc" },
  { label: "6500K", color: "#ffffff" },
  { label: "8000K", color: "#dbe6ff" },
] as const;

export function normalizeAngle(value: number) {
  return ((Math.round(value) % 360) + 360) % 360;
}
