export type StoryboardShot = {
  id: string;
  description: string;
  action: string;
  shotSize: string;
  dialogue: string;
  characters: string;
  scene: string;
  duration: number;
};

export type ScriptNodeState = {
  script: string;
  oneLiner: string;
  aiModel: string;
  shots: StoryboardShot[];
};

export const SCRIPT_SYSTEM = "你是资深中文短剧编剧。只输出剧本正文，不要任何解释、标题或 Markdown。剧本按镜头顺序叙述，包含人物、动作与台词，语言凝练有画面感。";

export function scriptPrompt(oneLiner: string) {
  return `把下面的创作灵感写成一部完整短剧剧本，600 到 1200 字，按镜头顺序分场景叙述，包含人物动作与台词。\n创作灵感：${oneLiner}`;
}

export const BREAKDOWN_SYSTEM = "你是专业影视分镜师。只输出符合要求的 JSON，不要 Markdown 代码块或任何解释。";

export function breakdownPrompt(script: string) {
  return `把下面的剧本拆解为分镜 JSON 数组，每项仅含这些字段：
{"description":"画面描述，包含构图、主体与视觉细节，120字内","action":"角色动作，80字内","shotSize":"远景/全景/中景/近景/特写 之一","dialogue":"该镜头的对白或旁白，无则空字符串","characters":"出场角色名，逗号分隔，无则空字符串","scene":"场景名称，20字内","duration":镜头建议时长(3到10的整数)}

要求：
- 按叙事顺序拆分，镜头数量 3 到 24 个
- description 必须是可直接用于文生图的视觉描述
- 剧本：${script}`;
}

function clampShot(raw: Record<string, unknown>, index: number): StoryboardShot {
  const read = (key: string, max: number) => {
    const value = typeof raw[key] === "string" ? (raw[key] as string).replace(/\s+/g, " ").trim() : "";
    return value.slice(0, max);
  };
  const duration = Math.min(10, Math.max(3, Math.round(Number(raw.duration)) || 5));
  return {
    id: crypto.randomUUID(),
    description: read("description", 200),
    action: read("action", 120),
    shotSize: read("shotSize", 12) || "中景",
    dialogue: read("dialogue", 160),
    characters: read("characters", 80),
    scene: read("scene", 40),
    duration,
  };
}

export function parseStoryboard(text: string): StoryboardShot[] {
  const content = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("AI 未返回有效的分镜 JSON 数组");
  let parsed: unknown;
  try { parsed = JSON.parse(content.slice(start, end + 1)); } catch { throw new Error("AI 返回的分镜 JSON 无法解析，请重试"); }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("AI 返回的分镜列表为空，请重试");
  const shots = parsed.slice(0, 24).map((item, index) => clampShot(item as Record<string, unknown>, index));
  if (!shots.some(shot => shot.description)) throw new Error("AI 返回的分镜缺少画面描述，请重试");
  return shots;
}

export function shotPrompt(shot: StoryboardShot) {
  const parts = [
    shot.description,
    shot.action && `人物动作：${shot.action}`,
    `景别：${shot.shotSize}`,
    shot.scene && `场景：${shot.scene}`,
    shot.characters && `出场角色：${shot.characters}`,
    shot.dialogue && (shot.shotSize === "特写" || shot.shotSize === "近景" ? `台词（人物在说话）：${shot.dialogue}` : ""),
  ].filter(Boolean);
  return parts.join("。") + "。";
}
