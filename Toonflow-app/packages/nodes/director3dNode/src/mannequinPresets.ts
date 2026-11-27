export interface MannequinPreset {
  name: string;
  height: number;
  build: number;
}

// ACT: 内置体型库 —— 白模预演只需表达身高与体积差，用统一骨架的非等比缩放实现，不额外引入模型资源。
export const mannequinPresets: MannequinPreset[] = [
  { name: "标准男性", height: 1.8, build: 1 },
  { name: "标准女性", height: 1.66, build: 0.92 },
  { name: "健硕", height: 1.85, build: 1.16 },
  { name: "纤细", height: 1.8, build: 0.84 },
  { name: "少年", height: 1.5, build: 0.88 },
  { name: "儿童", height: 1.1, build: 0.82 },
  { name: "宽厚", height: 1.75, build: 1.24 },
  { name: "二头身", height: 1.15, build: 1.5 },
];

export const mannequinBaseHeight = 1.8;

export function findMannequinPreset(name?: string) {
  return name ? mannequinPresets.find(preset => preset.name === name) : undefined;
}

// ACT: 身高决定纵向缩放，横截面积随身高同比收放，再用 build 叠加胖瘦；脚底始终在 y=0。
export function mannequinPresetScale(preset: MannequinPreset) {
  const ratio = preset.height / mannequinBaseHeight;
  const width = ratio * preset.build;
  return { scaleX: Math.round(width * 1000) / 1000, scaleY: Math.round(ratio * 1000) / 1000, scaleZ: Math.round(width * 1000) / 1000 };
}
