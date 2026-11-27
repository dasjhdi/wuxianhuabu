export interface OutputSpec {
  ratio: string;
  width: number;
  height: number;
  label: string;
  maxBytes?: number;
}

export interface Recipe {
  id: string;
  label: string;
  description: string;
  background: "white" | "generated";
  scenePrompt: string;
  compose: { scale: number; bottomGap: number };
  presets: OutputSpec[];
}

export const platformPresets: OutputSpec[] = [
  { ratio: "1:1", width: 1200, height: 1200, label: "1:1 主图 1200", maxBytes: 3 * 1024 * 1024 },
  { ratio: "1:1", width: 800, height: 800, label: "1:1 主图 800", maxBytes: 1 * 1024 * 1024 },
  { ratio: "3:4", width: 1242, height: 1656, label: "3:4 小红书 1242×1656", maxBytes: 3 * 1024 * 1024 },
  { ratio: "9:16", width: 1080, height: 1920, label: "9:16 抖音 1080×1920", maxBytes: 3 * 1024 * 1024 },
  { ratio: "16:9", width: 1920, height: 1080, label: "16:9 横版 1920×1080", maxBytes: 3 * 1024 * 1024 },
  { ratio: "1:1", width: 2000, height: 2000, label: "1:1 亚马逊 2000", maxBytes: 10 * 1024 * 1024 },
];

export const recipes: Recipe[] = [
  {
    id: "packshot",
    label: "白底主图",
    description: "纯白背景，突出商品轮廓，适合平台首图与规范审核。",
    background: "white",
    scenePrompt: "",
    compose: { scale: 0.62, bottomGap: 0.1 },
    presets: [platformPresets[0], platformPresets[1], platformPresets[5]],
  },
  {
    id: "lifestyle",
    label: "生活场景",
    description: "根据商品类目生成真实使用场景，适合第二张与种草图。",
    background: "generated",
    scenePrompt: "a realistic lifestyle scene with a clean surface and soft natural window light, subtle props that match the product category, shallow depth of field, empty foreground for product placement, no product, no text, no logo, no people",
    compose: { scale: 0.54, bottomGap: 0.08 },
    presets: [platformPresets[0], platformPresets[2], platformPresets[3]],
  },
  {
    id: "studio",
    label: "质感棚拍",
    description: "深色或渐变棚拍质感，适合客单价较高的品牌商品。",
    background: "generated",
    scenePrompt: "a premium studio backdrop with gradient lighting, subtle floor reflection, dramatic rim light, minimal composition, empty foreground for product placement, no product, no text, no logo, no people",
    compose: { scale: 0.56, bottomGap: 0.08 },
    presets: [platformPresets[0], platformPresets[3]],
  },
  {
    id: "model",
    label: "模特展示（实验）",
    description: "生成带人物的使用场景，再把商品合成到画面中央。人物与商品的位置可能需要人工筛选。",
    background: "generated",
    scenePrompt: "an editorial ecommerce photo of a model in a bright modern interior, natural pose with hands out of the center area, soft daylight, clean composition with empty space in the center foreground for a product, no product, no text, no logo",
    compose: { scale: 0.4, bottomGap: 0.16 },
    presets: [platformPresets[2], platformPresets[3]],
  },
];

export function findRecipe(id: string) {
  return recipes.find(recipe => recipe.id === id) ?? recipes[0];
}

export function buildScenePrompt(recipe: Recipe, brief: { title?: string; category?: string; sellingPoints?: string[] }, extra?: string) {
  const parts = [
    "Professional e-commerce background photograph",
    brief.category ? `for ${brief.category}` : "",
    brief.title ? `featuring ${brief.title}` : "",
    recipe.scenePrompt,
  ].filter(Boolean);
  if (extra?.trim()) parts.push(extra.trim());
  if (brief.sellingPoints?.length) parts.push(`mood: ${brief.sellingPoints.slice(0, 3).join(", ")}`);
  parts.push("high resolution, photorealistic, commercial advertising quality, 8k");
  return parts.join(", ");
}
