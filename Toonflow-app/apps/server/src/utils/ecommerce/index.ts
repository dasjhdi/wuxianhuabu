import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import conf from "@/utils/conf";
import { getDb } from "@/utils/auth";
import { prepareWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { generateMedia, listMediaModels } from "@/utils/media/generation";
import { removeBackground, type MattingConfig, type MattingProvider } from "./matting";
import { postProcessVideo, probeDuration, finishAvatarVideo, burnVideoLabel } from "./videoPost";
import { renderDetailModule, stackDetailImages } from "./detail";
import { renderTalkVideo } from "./talk";
import { pollAvatar, submitAvatar, type AvatarConfig, type AvatarProvider } from "./avatar";
import { parseSkuCsv, downloadImage } from "./batch";
import { zipSync } from "fflate";
import { buildScenePrompt, findRecipe, platformPresets, recipes, type OutputSpec } from "./recipes";
import { aiLabelFilter } from "./text";
import { measureWhitePurity, measureSubject, subjectRatio, formatSubject } from "./compliance";

const exec = promisify(execFile);
const TASK_TIMEOUT = 10 * 60 * 1000;

export interface EcommerceConfig {
  matting: MattingConfig;
  scene: { providerId?: string; modelId?: string };
  avatar: AvatarConfig;
}

export interface TaskOutput extends OutputSpec {
  path: string;
  url: string;
  kind?: "video";
  duration?: number;
}

export interface TaskRecord {
  id: string;
  type: "image" | "video" | "detail" | "talk" | "batch";
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  recipeId: string;
  outputs: TaskOutput[];
  warnings: string[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface VideoOutput extends TaskOutput {
  kind: "video";
  duration: number;
}

interface TaskRow {
  id: string;
  type: string | null;
  user_id: number | null;
  username: string | null;
  status: TaskRecord["status"];
  recipe: string;
  request: string;
  assets: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskInput {
  images: { data: string; mimeType: string; name?: string }[];
  brief: { title?: string; category?: string; sellingPoints?: string[] };
  recipeId: string;
  outputs: { ratio: string; width: number; height: number; label?: string }[];
  scenePrompt?: string;
  providerId?: string;
  modelId?: string;
  aiLabel?: boolean;
}

let schemaReady = false;
let queue: Promise<unknown> = Promise.resolve();
const cancelled = new Set<string>();

class TaskCancelled extends Error {
  constructor() {
    super("任务已取消");
  }
}

// ACT: 协作式取消：排队中的任务直接跳过，执行中的任务在下一个检查点退出；已发出的模型请求无法中断，但结果不会落盘。
function assertLive(id: string) {
  if (cancelled.has(id)) throw new TaskCancelled();
}

function scheduleTask(id: string, run: () => Promise<void>, label: string) {
  queue = queue
    .then(async () => {
      if (cancelled.delete(id)) return;
      assertLive(id);
      await run();
    })
    .catch((cause) => {
      const wasCancelled = cancelled.delete(id);
      if (wasCancelled || cause instanceof TaskCancelled) {
        console.error(`${label}已取消：${id}`);
        updateTask(id, { status: "failed", error: "任务已取消" });
        return;
      }
      console.error(`${label}失败：`, cause);
      const message = cause instanceof Error ? cause.message : "生成失败";
      // ACT: 任务整体失败时把未执行的行也落为失败，避免历史里出现「0 成功 0 失败」但仍有行在等待。
      db().run("UPDATE ecommerce_batch_items SET status = 'failed', error = ?, updated_at = ? WHERE task_id = ? AND status IN ('pending','running')", [message, Date.now(), id]);
      updateTask(id, { status: "failed", error: message });
    });
}

function db() {
  const database = getDb();
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ecommerce_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'image',
        user_id INTEGER,
        username TEXT,
        status TEXT NOT NULL,
        recipe TEXT NOT NULL,
        request TEXT NOT NULL,
        assets TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ecommerce_created ON ecommerce_tasks(created_at DESC);
      CREATE TABLE IF NOT EXISTS ecommerce_batch_items (
        task_id TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        files TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (task_id, row_index)
      );
      CREATE INDEX IF NOT EXISTS idx_batch_items_task ON ecommerce_batch_items(task_id);
    `);
    const columns = database.query("PRAGMA table_info(ecommerce_tasks)").all() as { name: string }[];
    if (!columns.some(column => column.name === "type")) database.exec("ALTER TABLE ecommerce_tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'image'");
    // ACT: 队列只存在于内存，进程重启后遗留的排队/执行中状态永远不会落终态，启动时统一回收并保留续跑入口。
    const stale = database.query("SELECT count(*) AS count FROM ecommerce_tasks WHERE status IN ('queued','running')").get() as { count: number };
    if (stale.count > 0) {
      const now = Date.now();
      database.run(
        "UPDATE ecommerce_tasks SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued','running')",
        ["服务重启导致任务中断，请重新提交；批量任务可点「续跑失败行」", now],
      );
      database.run(
        "UPDATE ecommerce_batch_items SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('pending','running')",
        ["服务重启中断", now],
      );
      console.log(`[ecommerce] 已回收 ${stale.count} 个中断任务`);
    }
    schemaReady = true;
  }
  return database;
}

// ACT: 用一张 256×256 的纯色图打一次真实抠图，验证 Key、接口地址与配额是否可用；会消耗 1 次调用额度。
export async function testMatting() {
  const config = getConfig();
  if (!config.matting.apiKey) throw Object.assign(new Error("请先填写抠图 API Key"), { status: 400 });
  const directory = join(rootDirectory(), ".probe");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "probe.png");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=0xEDEDED:s=256x256", "-frames:v", "1", file]);
  const started = Date.now();
  const result = await removeBackground(new Uint8Array(await readFile(file)), "image/png", config.matting);
  return { provider: config.matting.provider, latencyMs: Date.now() - started, bytes: result.data.length };
}

export function rootDirectory() {
  return resolve(dirname(conf.path), "ecommerce");
}

export function taskDirectory(id: string) {
  return join(rootDirectory(), id);
}

export function getConfig(): EcommerceConfig {
  const settings = conf.get("settings", {}) as Record<string, unknown>;
  const raw = settings.ecommerce && typeof settings.ecommerce === "object" ? settings.ecommerce as Record<string, unknown> : {};
  const matting = raw.matting && typeof raw.matting === "object" ? raw.matting as Record<string, unknown> : {};
  const scene = raw.scene && typeof raw.scene === "object" ? raw.scene as Record<string, unknown> : {};
  const avatar = raw.avatar && typeof raw.avatar === "object" ? raw.avatar as Record<string, unknown> : {};
  const provider: MattingProvider = matting.provider === "removebg" || matting.provider === "custom" ? matting.provider : "photoroom";
  const avatarProvider: AvatarProvider = avatar.provider === "did" || avatar.provider === "custom" ? avatar.provider : "none";
  return {
    matting: {
      provider,
      apiKey: typeof matting.apiKey === "string" ? matting.apiKey : "",
      endpoint: typeof matting.endpoint === "string" ? matting.endpoint : undefined,
    },
    scene: {
      providerId: typeof scene.providerId === "string" ? scene.providerId : undefined,
      modelId: typeof scene.modelId === "string" ? scene.modelId : undefined,
    },
    avatar: {
      provider: avatarProvider,
      apiKey: typeof avatar.apiKey === "string" ? avatar.apiKey : "",
      endpoint: typeof avatar.endpoint === "string" ? avatar.endpoint : undefined,
    },
  };
}

export function publicConfig() {
  const config = getConfig();
  return {
    matting: { provider: config.matting.provider, configured: !!config.matting.apiKey, endpoint: config.matting.endpoint ?? "" },
    scene: config.scene,
    avatar: { provider: config.avatar.provider, configured: !!config.avatar.apiKey, endpoint: config.avatar.endpoint ?? "" },
    recipes,
    presets: platformPresets,
  };
}

export function saveConfig(patch: Record<string, unknown>) {
  const current = getConfig();
  const matting = patch.matting && typeof patch.matting === "object" ? patch.matting as Record<string, unknown> : {};
  const scene = patch.scene && typeof patch.scene === "object" ? patch.scene as Record<string, unknown> : {};
  const avatar = patch.avatar && typeof patch.avatar === "object" ? patch.avatar as Record<string, unknown> : {};
  const next: EcommerceConfig = {
    matting: {
      provider: matting.provider === "removebg" || matting.provider === "custom" ? matting.provider : matting.provider === "photoroom" ? "photoroom" : current.matting.provider,
      apiKey: typeof matting.apiKey === "string" ? matting.apiKey.trim() : current.matting.apiKey,
      endpoint: typeof matting.endpoint === "string" ? matting.endpoint.trim() || undefined : current.matting.endpoint,
    },
    scene: {
      providerId: typeof scene.providerId === "string" ? scene.providerId : current.scene.providerId,
      modelId: typeof scene.modelId === "string" ? scene.modelId : current.scene.modelId,
    },
    avatar: {
      provider: avatar.provider === "did" || avatar.provider === "custom" || avatar.provider === "none" ? avatar.provider : current.avatar.provider,
      apiKey: typeof avatar.apiKey === "string" ? avatar.apiKey.trim() : current.avatar.apiKey,
      endpoint: typeof avatar.endpoint === "string" ? avatar.endpoint.trim() || undefined : current.avatar.endpoint,
    },
  };
  const settings = conf.get("settings", {}) as Record<string, unknown>;
  conf.set("settings", { ...settings, ecommerce: next });
  return next;
}

function rowToTask(row: TaskRow): TaskRecord {
  let outputs: TaskOutput[] = [];
  let warnings: string[] = [];
  if (row.assets) {
    try {
      const parsed = JSON.parse(row.assets) as { outputs?: TaskOutput[]; warnings?: string[] };
      outputs = Array.isArray(parsed.outputs) ? parsed.outputs : [];
      warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    } catch {}
  }
  return {
    id: row.id,
    type: row.type === "video" || row.type === "detail" || row.type === "talk" || row.type === "batch" ? row.type : "image",
    status: row.status,
    recipeId: row.recipe,
    outputs,
    warnings,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type TaskViewer = { id: number; role: string } | null;

function getTaskRow(id: string) {
  return db().query("SELECT * FROM ecommerce_tasks WHERE id = ?").get(id) as TaskRow | null;
}

// ACT: undefined 表示调用方没有显式做权限判断，按拒绝处理，避免漏传参数导致越权；null 为已配对的设备令牌。
function canAccessTask(row: TaskRow, user: TaskViewer | undefined) {
  if (user === undefined) return false;
  if (user === null) return true;
  return user.role === "admin" || row.user_id === user.id;
}

function taskScope(user: TaskViewer | undefined): { clause: string; params: (string | number)[] } {
  if (user === undefined) return { clause: "1 = 0", params: [] };
  if (user === null || user.role === "admin") return { clause: "1 = 1", params: [] };
  return { clause: "user_id = ?", params: [user.id] };
}

export function getTask(id: string, user?: TaskViewer) {
  const row = getTaskRow(id);
  if (!row || !canAccessTask(row, user)) return null;
  return rowToTask(row);
}

export function listTasks(limit = 20, user?: TaskViewer) {
  const scope = taskScope(user);
  const rows = db().query(`SELECT * FROM ecommerce_tasks WHERE ${scope.clause} ORDER BY created_at DESC LIMIT ?`).all(...scope.params, Math.min(50, Math.max(1, limit))) as TaskRow[];
  return rows.map(rowToTask);
}

function updateTask(id: string, patch: { status?: TaskRecord["status"]; outputs?: TaskOutput[]; warnings?: string[]; error?: string | null }) {
  const current = db().query("SELECT * FROM ecommerce_tasks WHERE id = ?").get(id) as TaskRow | null;
  if (!current) return;
  db().run(
    "UPDATE ecommerce_tasks SET status = ?, assets = ?, error = ?, updated_at = ? WHERE id = ?",
    [patch.status ?? current.status, patch.outputs || patch.warnings ? JSON.stringify({ outputs: patch.outputs ?? [], warnings: patch.warnings ?? [] }) : current.assets, patch.error === undefined ? current.error : patch.error, Date.now(), id],
  );
}

export type BatchItemStatus = "pending" | "running" | "succeeded" | "failed";

export interface BatchItem {
  index: number;
  title: string;
  status: BatchItemStatus;
  error: string | null;
  files: { width: number; height: number; path: string }[];
}

interface BatchItemDbRow {
  row_index: number;
  title: string;
  status: string;
  error: string | null;
  files: string | null;
}

function writeBatchItem(taskId: string, index: number, title: string, status: BatchItemStatus, error: string | null, files: BatchItem["files"]) {
  db().run(
    `INSERT INTO ecommerce_batch_items (task_id, row_index, title, status, error, files, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id, row_index) DO UPDATE SET
       title = excluded.title, status = excluded.status, error = excluded.error, files = excluded.files, updated_at = excluded.updated_at`,
    [taskId, index, title, status, error, JSON.stringify(files), Date.now()],
  );
}

export function listBatchItems(taskId: string): BatchItem[] {
  const rows = db().query("SELECT * FROM ecommerce_batch_items WHERE task_id = ? ORDER BY row_index ASC").all(taskId) as BatchItemDbRow[];
  return rows.map(row => {
    let files: BatchItem["files"] = [];
    if (row.files) {
      try {
        const parsed = JSON.parse(row.files) as BatchItem["files"];
        if (Array.isArray(parsed)) files = parsed;
      } catch {}
    }
    const status: BatchItemStatus = row.status === "running" || row.status === "succeeded" || row.status === "failed" ? row.status : "pending";
    return { index: row.row_index, title: row.title, status, error: row.error, files };
  });
}

interface BatchRequest {
  csv: string;
  style: "white" | "scene";
  scenePrompt?: string;
  providerId?: string;
  modelId?: string;
  targets?: { ratio?: string; width: number; height: number }[];
  aiLabel?: boolean;
  video?: { ratio?: "9:16" | "1:1" | "16:9"; duration?: number; transition?: "none" | "fade" | "slide"; subtitles?: boolean };
  rows?: number;
}

function parseBatchRequest(raw: string): BatchRequest {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      csv: typeof parsed.csv === "string" ? parsed.csv : "",
      style: parsed.style === "scene" ? "scene" : "white",
      scenePrompt: typeof parsed.scenePrompt === "string" ? parsed.scenePrompt : undefined,
      providerId: typeof parsed.providerId === "string" ? parsed.providerId : undefined,
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : undefined,
      targets: Array.isArray(parsed.targets) ? parsed.targets as BatchRequest["targets"] : undefined,
      aiLabel: typeof parsed.aiLabel === "boolean" ? parsed.aiLabel : undefined,
      video: parsed.video && typeof parsed.video === "object" ? parsed.video as BatchRequest["video"] : undefined,
      rows: typeof parsed.rows === "number" ? parsed.rows : 0,
    };
  } catch {
    return { csv: "", style: "white" };
  }
}

export function listBatchTasks(limit = 20, offset = 0, user?: TaskViewer) {
  const scope = taskScope(user);
  const rows = db()
    .query(`SELECT * FROM ecommerce_tasks WHERE type = 'batch' AND ${scope.clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...scope.params, Math.min(50, Math.max(1, limit)), Math.max(0, offset)) as TaskRow[];
  return rows.map(row => {
    const request = parseBatchRequest(row.request);
    const items = listBatchItems(row.id);
    const succeeded = items.filter(item => item.status === "succeeded").length;
    const failed = items.filter(item => item.status === "failed").length;
    const task = rowToTask(row);
    return {
      id: row.id,
      status: row.status,
      style: request.style,
      mode: request.video ? "video" as const : "image" as const,
      sizes: request.video ? [request.video.ratio ?? "9:16"] : (request.targets ?? []).map(target => `${target.width}x${target.height}`),
      total: items.length || request.rows || 0,
      succeeded,
      failed,
      legacy: items.length === 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      zipUrl: task.outputs.find(output => output.path.endsWith(".zip"))?.url ?? null,
      canResume: failed > 0 && row.status !== "queued" && row.status !== "running",
    };
  });
}

export function countBatchTasks(user?: TaskViewer) {
  const scope = taskScope(user);
  const row = db().query(`SELECT count(*) AS count FROM ecommerce_tasks WHERE type = 'batch' AND ${scope.clause}`).get(...scope.params) as { count: number };
  return row.count;
}

async function runFfmpeg(args: string[]) {
  const { ffmpeg } = await prepareWorkspaceFfmpeg();
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 16 * 1024 * 1024 });
}

async function pickSceneModel(input: { brief?: TaskInput["brief"]; providerId?: string; modelId?: string }) {
  const config = getConfig();
  const providerId = input.providerId || config.scene.providerId;
  const modelId = input.modelId || config.scene.modelId;
  const models = await listMediaModels();
  const images = models.filter(model => model.type === "image");
  return (providerId && modelId ? images.find(model => model.providerId === providerId && model.modelId === modelId) : undefined) ?? images[0] ?? null;
}

function extensionFor(mimeType: string) {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

async function createBackground(input: TaskInput, recipeId: string, spec: OutputSpec, taskId: string, warnings: string[]) {
  const directory = taskDirectory(taskId);
  const target = join(directory, `background-${spec.width}x${spec.height}.png`);
  const recipe = findRecipe(recipeId);
  if (recipe.background === "white") {
    await runFfmpeg(["-f", "lavfi", "-i", `color=c=white:s=${spec.width}x${spec.height}`, "-frames:v", "1", target]);
    return target;
  }
  const model = await pickSceneModel(input);
  if (!model) throw Object.assign(new Error("没有可用的图片生成模型，请先在设置中配置供应商"), { status: 400 });
  const modes = Array.isArray(model.mode) ? model.mode as string[] : [];
  if (modes.length && !modes.includes("text") && !modes.includes("singleImage")) {
    throw Object.assign(new Error(`模型「${model.label}」不支持纯文本生成场景，请换用支持文生图的模型`), { status: 400 });
  }
  const prompt = buildScenePrompt(recipe, input.brief, input.scenePrompt);
  const files = await generateMedia(directory, "image", {
    providerId: model.providerId,
    modelId: model.modelId,
    prompt,
    ratio: spec.ratio,
    outputDirectory: "scenes",
  }, AbortSignal.timeout(TASK_TIMEOUT));
  const scene = files[0];
  if (!scene) throw new Error("场景图生成失败");
  const scenePath = join(directory, scene.path);
  await runFfmpeg([
    "-i", scenePath,
    "-vf", `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase,crop=${spec.width}:${spec.height}`,
    "-frames:v", "1", target,
  ]);
  warnings.push(`场景由 ${model.providerLabel} / ${model.label} 生成`);
  return target;
}

async function compose(background: string, foreground: string, spec: OutputSpec, recipeId: string, outputPath: string, degraded: boolean, options: { aiLabel?: boolean } = {}) {
  const recipe = findRecipe(recipeId);
  // ACT: 同时约束宽高，避免竖长商品在 16:9 等宽画布上按宽度放大后超出画面顶部。
  const maxWidth = Math.round(spec.width * recipe.compose.scale);
  const maxHeight = Math.round(spec.height * Math.max(0.4, 1 - recipe.compose.bottomGap - 0.06));
  const gap = Math.round(spec.height * recipe.compose.bottomGap);
  const label = options.aiLabel === false ? null : aiLabelFilter(spec.width, spec.height);
  const overlay = `[0:v][fg]overlay=(W-w)/2:H-h-${gap}:format=auto${label ? `,${label}` : ""}`;
  const filters = [`[1:v]scale=${maxWidth}:${maxHeight}:force_original_aspect_ratio=decrease${degraded ? ",colorkey=0xFFFFFF:0.10:0.02" : ""}[fg]`, overlay];
  const jpeg = /\.jpe?g$/i.test(outputPath);
  await runFfmpeg([
    "-i", background,
    "-i", foreground,
    "-filter_complex", filters.join(";"),
    "-frames:v", "1",
    ...(jpeg ? ["-q:v", "2"] : []),
    ...(label ? ["-metadata", "comment=AI-generated content"] : []),
    outputPath,
  ]);
}

// ACT: 平台对主图有大小上限，超限时逐级降质，仍然超限则保留原图并在 warnings 中说明。
async function fitJpeg(file: string, maxBytes?: number) {
  if (!maxBytes) return false;
  const size = (await stat(file)).size;
  if (size <= maxBytes) return false;
  const temp = `${file}.tmp.jpg`;
  for (const quality of [4, 6, 8, 10, 12, 16, 20]) {
    await runFfmpeg(["-i", file, "-q:v", String(quality), temp]);
    if ((await stat(temp)).size <= maxBytes) {
      await rename(temp, file);
      return true;
    }
  }
  await rm(temp, { force: true }).catch(() => {});
  return false;
}

function maxBytesFor(width: number, height: number) {
  return platformPresets.find(preset => preset.width === width && preset.height === height)?.maxBytes;
}

async function applyAiLabel(file: string, width: number, height: number) {
  const label = aiLabelFilter(width, height);
  if (!label) return false;
  const temp = file.replace(/\.jpg$/i, "-label.jpg");
  await runFfmpeg(["-i", file, "-vf", label, "-q:v", "2", "-metadata", "comment=AI-generated content", temp]);
  await rename(temp, file);
  return true;
}

// ACT: ffmpeg 的 mjpeg 编码器不会写 COM 段，这里直接插入 JPEG Comment，供平台与工具读取隐式标识。
async function injectJpegComment(file: string, text: string) {
  if (!file.toLowerCase().endsWith(".jpg")) return false;
  const bytes = new Uint8Array(await readFile(file));
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  const payload = new TextEncoder().encode(text);
  const length = payload.length + 2;
  if (length > 65533 || bytes.length < 4) return false;
  const segment = new Uint8Array(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xfe;
  segment[2] = length >> 8;
  segment[3] = length & 0xff;
  segment.set(payload, 4);
  const output = new Uint8Array(bytes.length + segment.length);
  output.set(bytes.subarray(0, 2), 0);
  output.set(segment, 2);
  output.set(bytes.subarray(2), 2 + segment.length);
  await writeFile(file, output);
  return true;
}

async function executeTask(id: string, input: TaskInput) {
  const directory = taskDirectory(id);
  await mkdir(directory, { recursive: true });
  const warnings: string[] = [];
  assertLive(id);
  updateTask(id, { status: "running", outputs: [], warnings, error: null });

  const image = input.images[0];
  const original = join(directory, `input.${extensionFor(image.mimeType)}`);
  await writeFile(original, Buffer.from(image.data, "base64"));

  let foreground = original;
  let degraded = false;
  const config = getConfig();
  if (config.matting.apiKey) {
    try {
      const result = await removeBackground(await readFile(original), image.mimeType, config.matting);
      foreground = join(directory, "cutout.png");
      await writeFile(foreground, result.data);
    } catch (cause) {
      degraded = true;
      warnings.push(`抠图失败，已改用原图合成：${cause instanceof Error ? cause.message : "未知错误"}`);
    }
  } else {
    degraded = true;
    warnings.push("尚未配置抠图服务，当前使用原图 + 白底去背的降级方案，商品边缘与浅色区域可能不准确");
  }

  const outputs: TaskOutput[] = [];
  const compressed = new Set<string>();
  const recipe = findRecipe(input.recipeId);
  const checkWhite = recipe.background === "white";
  const subjectBase = checkWhite && !degraded ? await measureSubject(foreground) : null;
  const subjectRatios: { width: number; height: number }[] = [];
  const compliance: string[] = [];
  let purityChecked = false;
  for (const item of input.outputs) {
    assertLive(id);
    const spec: OutputSpec = { ...item, label: item.label?.trim() || `${item.ratio} ${item.width}×${item.height}` };
    const background = await createBackground(input, input.recipeId, spec, id, warnings);
    const fileName = `final-${spec.width}x${spec.height}.jpg`;
    const target = join(directory, fileName);
    await compose(background, foreground, spec, input.recipeId, target, degraded, { aiLabel: input.aiLabel });
    if (await fitJpeg(target, maxBytesFor(spec.width, spec.height))) compressed.add(`${spec.width}×${spec.height}`);
    if (input.aiLabel !== false) await injectJpegComment(target, "AI-generated content");
    if (checkWhite) {
      // ACT: 白底纯度只需验证一次（同一背景，尺寸不同不影响），主体占比则按每个画布分别计算。
      if (!purityChecked) {
        const purity = await measureWhitePurity(target);
        if (purity) {
          compliance.push(`白底纯度 ${purity.percent}%（${purity.pass ? "通过" : "偏低"}）`);
          purityChecked = true;
        }
      }
      if (subjectBase) subjectRatios.push(subjectRatio(subjectBase, spec, recipe.compose));
    }
    outputs.push({ ...spec, path: fileName, url: `/api/ecommerce/assets/${id}/${fileName}` });
  }
  if (compressed.size) warnings.push(`已按平台大小上限压缩：${[...compressed].join("、")}`);
  if (checkWhite) {
    if (!subjectBase) compliance.push(degraded ? "未抠图（降级），无法校验主体占比" : "无法读取商品边界，主体占比未校验");
    else {
      const text = formatSubject(subjectRatios);
      if (text) compliance.push(`主体占比 ${text}`);
    }
    if (compliance.length) warnings.push(...compliance.map(item => `【合规】${item}`));
  }

  updateTask(id, { status: degraded ? "partial" : "succeeded", outputs, warnings, error: null });
}

export function enqueueTask(input: TaskInput, user: { id: number; username: string }) {
  // ACT: 单进程串行执行，避免多个任务同时占用 ffmpeg 与模型并发额度。
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db().run(
    "INSERT INTO ecommerce_tasks (id, type, user_id, username, status, recipe, request, assets, error, created_at, updated_at) VALUES (?, 'image', ?, ?, 'queued', ?, ?, NULL, NULL, ?, ?)",
    [id, user.id, user.username, input.recipeId, JSON.stringify({ brief: input.brief, outputs: input.outputs }), now, now],
  );
  scheduleTask(id, () => executeTask(id, input), "电商任务");
  return { id, status: "queued" as const };
}

export async function readAsset(id: string, file: string, user?: TaskViewer) {
  if (!/^[a-f0-9]{16}$/.test(id)) throw Object.assign(new Error("任务编号无效"), { status: 400 });
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) throw Object.assign(new Error("文件名无效"), { status: 400 });
  const row = getTaskRow(id);
  if (!row || !canAccessTask(row, user)) throw Object.assign(new Error("任务不存在"), { status: 404 });
  const path = join(taskDirectory(id), file);
  const bytes = await readFile(path);
  return { path, bytes };
}

export interface VideoInput {
  images: TaskInput["images"];
  brief?: TaskInput["brief"];
  ratio: "9:16" | "1:1" | "16:9";
  duration: number;
  prompt?: string;
  transition?: "none" | "fade" | "slide";
  bgm?: { data: string; mimeType: string };
  subtitles?: string[];
  providerId?: string;
  modelId?: string;
  bgmPath?: string;
  aiLabel?: boolean;
}

const videoSizes: Record<VideoInput["ratio"], [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080] };
const shotPrompts = [
  "cinematic hero shot of the product, slow push-in camera movement, soft studio lighting, clean background, product stays still and undistorted, no text",
  "extreme close-up of the product texture and details, slow lateral camera slide, macro lens, soft highlights, product stays still, no text",
  "the product on a clean surface with subtle lifestyle context, slow orbit camera movement, shallow depth of field, product stays still, no text",
];

async function pickVideoModel(input: { providerId?: string; modelId?: string }) {
  const models = (await listMediaModels()).filter(model => model.type === "video");
  if (!models.length) throw Object.assign(new Error("没有可用的视频生成模型，请先在设置中配置供应商"), { status: 400 });
  const specified = input.providerId && input.modelId;
  const model = specified
    ? models.find(item => item.providerId === input.providerId && item.modelId === input.modelId)
    : models[0];
  if (!model) throw Object.assign(new Error("指定的视频模型不可用，请重新选择"), { status: 400 });
  const modes = Array.isArray(model.mode) ? model.mode as string[] : [];
  if (modes.length && !modes.includes("singleImage") && !modes.includes("startFrameOptional")) {
    throw Object.assign(new Error(`模型「${model.label}」不支持图生视频，请换用支持首帧的模型`), { status: 400 });
  }
  return model;
}

function pickVideoDuration(model: { durationResolutionMap?: { duration: number[] }[] }) {
  const durations = (model.durationResolutionMap ?? []).flatMap(item => item.duration).filter(value => Number.isFinite(value) && value > 0);
  if (!durations.length) return 5;
  return durations.reduce((best, value) => Math.abs(value - 5) < Math.abs(best - 5) ? value : best, durations[0]);
}

interface RenderedVideo {
  fileName: string;
  width: number;
  height: number;
  duration: number;
  count: number;
  segmentDuration: number;
  model: Awaited<ReturnType<typeof pickVideoModel>>;
}

// ACT: 单条生成与批量生成共用同一套分段、转场、BGM、字幕管线，避免两处逻辑漂移。
async function renderVideo(directory: string, input: VideoInput, id: string, warnings: string[], resolved?: Awaited<ReturnType<typeof pickVideoModel>>): Promise<RenderedVideo> {
  const image = input.images[0];
  const inputName = `input.${extensionFor(image.mimeType)}`;
  await writeFile(join(directory, inputName), Buffer.from(image.data, "base64"));

  const model = resolved ?? await pickVideoModel(input);
  const segmentDuration = pickVideoDuration(model);
  const count = Math.min(3, Math.max(1, Math.round(input.duration / 5)));
  const [width, height] = videoSizes[input.ratio];
  const extra = input.prompt?.trim();
  const segments: string[] = [];
  const modes = Array.isArray(model.mode) ? model.mode as string[] : [];
  const useSingleImage = modes.length === 0 || modes.includes("singleImage");
  const frame = { path: inputName, mimeType: image.mimeType };

  for (let index = 0; index < count; index += 1) {
    assertLive(id);
    const prompt = [shotPrompts[index], extra].filter(Boolean).join(", ");
    const files = await generateMedia(directory, "video", {
      providerId: model.providerId,
      modelId: model.modelId,
      prompt,
      mode: useSingleImage ? "singleImage" : "startFrameOptional",
      ...(useSingleImage ? { images: [frame] } : { firstFrame: frame }),
      duration: segmentDuration,
      ratio: input.ratio,
      outputDirectory: "segments",
    }, AbortSignal.timeout(25 * 60 * 1000));
    const file = files[0];
    if (!file) throw new Error(`第 ${index + 1} 段视频生成失败`);
    segments.push(join(directory, file.path));
  }

  const fileName = `video-${width}x${height}.mp4`;
  const target = join(directory, fileName);
  let bgmPath = input.bgmPath;
  if (!bgmPath && input.bgm?.data) {
    const extension = input.bgm.mimeType.includes("wav") ? "wav" : input.bgm.mimeType.includes("mp4") || input.bgm.mimeType.includes("m4a") ? "m4a" : "mp3";
    bgmPath = join(directory, `bgm.${extension}`);
    await writeFile(bgmPath, Buffer.from(input.bgm.data, "base64"));
  }
  const postWarnings = await postProcessVideo({
    segments,
    directory,
    width,
    height,
    transition: input.transition ?? "fade",
    bgmPath,
    subtitles: input.subtitles ?? [],
    aiLabel: input.aiLabel !== false,
    output: target,
  });
  warnings.push(...postWarnings);
  return { fileName, width, height, duration: count * segmentDuration, count, segmentDuration, model };
}

async function executeVideoTask(id: string, input: VideoInput) {
  const directory = taskDirectory(id);
  await mkdir(directory, { recursive: true });
  const warnings: string[] = [];
  assertLive(id);
  updateTask(id, { status: "running", outputs: [], warnings, error: null });

  const rendered = await renderVideo(directory, input, id, warnings);
  warnings.push(`由 ${rendered.model.providerLabel} / ${rendered.model.label} 生成 ${rendered.count} 段，拼接为 ${rendered.duration} 秒`);

  const output: VideoOutput = {
    ratio: input.ratio,
    width: rendered.width,
    height: rendered.height,
    label: `${input.ratio} 主图视频`,
    path: rendered.fileName,
    url: `/api/ecommerce/assets/${id}/${rendered.fileName}`,
    kind: "video",
    duration: rendered.duration,
  };
  updateTask(id, { status: "succeeded", outputs: [output], warnings, error: null });
}

export function enqueueVideoTask(input: VideoInput, user: { id: number; username: string }) {
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db().run(
    "INSERT INTO ecommerce_tasks (id, type, user_id, username, status, recipe, request, assets, error, created_at, updated_at) VALUES (?, 'video', ?, ?, 'queued', 'video', ?, NULL, NULL, ?, ?)",
    [id, user.id, user.username, JSON.stringify({ ratio: input.ratio, duration: input.duration, brief: input.brief }), now, now],
  );
  scheduleTask(id, () => executeVideoTask(id, input), "电商视频任务");
  return { id, status: "queued" as const };
}

export interface DetailInput {
  images: TaskInput["images"];
  brief: TaskInput["brief"];
  width?: number;
  style?: "scene" | "white";
  providerId?: string;
  modelId?: string;
  aiLabel?: boolean;
}

async function prepareCutout(directory: string, image: TaskInput["images"][number], warnings: string[]) {
  const inputName = `input.${extensionFor(image.mimeType)}`;
  const original = join(directory, inputName);
  await writeFile(original, Buffer.from(image.data, "base64"));
  const config = getConfig();
  if (!config.matting.apiKey) {
    warnings.push("尚未配置抠图服务，详情页使用原图合成，商品边缘可能不干净");
    return original;
  }
  try {
    const result = await removeBackground(await readFile(original), image.mimeType, config.matting);
    const cutout = join(directory, "cutout.png");
    await writeFile(cutout, result.data);
    return cutout;
  } catch (cause) {
    warnings.push(`抠图失败，已改用原图合成：${cause instanceof Error ? cause.message : "未知错误"}`);
    return original;
  }
}

async function detailBackground(
  input: DetailInput,
  kind: "hero" | "point" | "footer",
  label: string,
  width: number,
  height: number,
  directory: string,
  index: number,
) {
  const target = join(directory, `bg-${kind}-${index}.png`);
  if (input.style === "white") {
    await runFfmpeg(["-f", "lavfi", "-i", `color=c=white:s=${width}x${height}`, "-frames:v", "1", target]);
    return target;
  }
  const model = await pickSceneModel(input);
  if (!model) throw Object.assign(new Error("没有可用的图片生成模型"), { status: 400 });
  const prompt = [
    "E-commerce detail page background",
    kind === "hero" ? "premium hero banner, dramatic soft studio lighting" : kind === "point" ? `lifestyle scene illustrating ${label}` : "minimal brand backdrop, subtle texture",
    input.brief.category ? `for ${input.brief.category}` : "",
    "empty space for product placement, no product, no text, no logo, photorealistic, high end commercial photography",
  ].filter(Boolean).join(", ");
  const files = await generateMedia(directory, "image", {
    providerId: model.providerId,
    modelId: model.modelId,
    prompt,
    ratio: "3:4",
    outputDirectory: "scenes",
  }, AbortSignal.timeout(TASK_TIMEOUT));
  const scene = files[0];
  if (!scene) throw new Error("详情页背景生成失败");
  await runFfmpeg([
    "-i", join(directory, scene.path),
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-frames:v", "1", target,
  ]);
  return target;
}

async function executeDetailTask(id: string, input: DetailInput) {
  const directory = taskDirectory(id);
  await mkdir(directory, { recursive: true });
  const warnings: string[] = [];
  assertLive(id);
  updateTask(id, { status: "running", outputs: [], warnings, error: null });

  const width = input.width === 800 ? 800 : 750;
  const points = (input.brief.sellingPoints ?? []).map(item => item.trim()).filter(Boolean).slice(0, 4);
  if (!points.length) points.push("细节与品质");
  const foreground = await prepareCutout(directory, input.images[0], warnings);
  const dark = input.style === "white";
  const modules: string[] = [];
  const heights: number[] = [];

  const heroHeight = 1000;
  const heroBg = await detailBackground(input, "hero", input.brief.title ?? "商品详情", width, heroHeight, directory, 1);
  const hero = join(directory, "module-1.png");
  await renderDetailModule({
    background: heroBg, foreground, width, height: heroHeight, kind: "hero",
    title: input.brief.title ?? "商品详情", subtitle: input.brief.category, dark, output: hero,
  });
  modules.push(hero);
  heights.push(heroHeight);

  for (let index = 0; index < points.length; index += 1) {
    assertLive(id);
    const height = 900;
    const background = await detailBackground(input, "point", points[index], width, height, directory, index + 2);
    const target = join(directory, `module-${index + 2}.png`);
    await renderDetailModule({
      background, foreground, width, height, kind: "point",
      title: points[index], index: index + 1, dark, output: target,
    });
    modules.push(target);
    heights.push(height);
  }

  const footerHeight = 600;
  const footerBg = await detailBackground(input, "footer", "", width, footerHeight, directory, modules.length + 1);
  const footer = join(directory, `module-${modules.length + 1}.png`);
  await renderDetailModule({
    background: footerBg, width, height: footerHeight, kind: "footer",
    title: "品质保障 · 放心购买", subtitle: "正品保障 · 7 天无理由退换", dark, output: footer,
  });
  modules.push(footer);
  heights.push(footerHeight);

  const fileName = `detail-${width}.jpg`;
  await stackDetailImages(modules, join(directory, fileName));
  const totalHeight = heights.reduce((sum, value) => sum + value, 0);
  if (input.aiLabel !== false) {
    await applyAiLabel(join(directory, fileName), width, totalHeight);
    await injectJpegComment(join(directory, fileName), "AI-generated content");
  }
  warnings.push(`共 ${modules.length} 屏，宽度 ${width}px，总高 ${totalHeight}px`);

  updateTask(id, {
    status: "succeeded",
    outputs: [{ ratio: `${width}:${totalHeight}`, width, height: totalHeight, label: `详情页长图 ${width}px`, path: fileName, url: `/api/ecommerce/assets/${id}/${fileName}` }],
    warnings,
    error: null,
  });
}

export function enqueueDetailTask(input: DetailInput, user: { id: number; username: string }) {
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db().run(
    "INSERT INTO ecommerce_tasks (id, type, user_id, username, status, recipe, request, assets, error, created_at, updated_at) VALUES (?, 'detail', ?, ?, 'queued', 'detail', ?, NULL, NULL, ?, ?)",
    [id, user.id, user.username, JSON.stringify({ width: input.width, style: input.style, brief: input.brief }), now, now],
  );
  scheduleTask(id, () => executeDetailTask(id, input), "详情页任务");
  return { id, status: "queued" as const };
}

export interface TalkInput {
  images: TaskInput["images"];
  script: string;
  ratio: "9:16" | "1:1";
  voice?: { providerId: string; modelId: string; voice?: string };
  subtitles?: boolean;
  aiLabel?: boolean;
}

function splitScript(text: string) {
  const parts = text.replace(/\s+/g, " ").split(/(?<=[。！？；!?;])/).map(item => item.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const part of parts) {
    if (part.length <= 24) lines.push(part);
    else for (let index = 0; index < part.length; index += 24) lines.push(part.slice(index, index + 24));
  }
  return lines.slice(0, 8);
}

async function executeTalkTask(id: string, input: TalkInput) {
  const directory = taskDirectory(id);
  await mkdir(directory, { recursive: true });
  const warnings: string[] = [];
  assertLive(id);
  updateTask(id, { status: "running", outputs: [], warnings, error: null });

  const image = input.images[0];
  const portrait = join(directory, `portrait.${extensionFor(image.mimeType)}`);
  await writeFile(portrait, Buffer.from(image.data, "base64"));

  const models = (await listMediaModels()).filter(model => model.type === "audio");
  if (!models.length) throw Object.assign(new Error("没有可用的语音合成模型，请先配置供应商"), { status: 400 });
  const specified = !!input.voice?.providerId && !!input.voice?.modelId;
  const model = specified
    ? models.find(item => item.providerId === input.voice!.providerId && item.modelId === input.voice!.modelId)
    : models[0];
  if (!model) throw Object.assign(new Error("指定的语音模型不可用，请重新选择"), { status: 400 });
  const files = await generateMedia(directory, "audio", {
    providerId: model.providerId,
    modelId: model.modelId,
    prompt: input.script,
    voice: input.voice?.voice ?? model.voices?.[0]?.voice,
    outputDirectory: "voice",
  }, AbortSignal.timeout(10 * 60 * 1000));
  const audio = files[0];
  if (!audio) throw new Error("语音合成失败");
  const audioPath = join(directory, audio.path);
  const duration = await probeDuration(audioPath);
  if (!duration) throw new Error("无法读取语音时长");

  const [width, height] = input.ratio === "1:1" ? [1080, 1080] : [1080, 1920];
  const fileName = `talk-${width}x${height}.mp4`;
  const subtitles = input.subtitles === false ? [] : splitScript(input.script);
  const avatarConfig = getConfig().avatar;
  let rendered = false;

  if (avatarConfig.provider !== "none" && avatarConfig.apiKey) {
    try {
      const submitted = await submitAvatar({
        image: new Uint8Array(await readFile(portrait)),
        imageMime: image.mimeType,
        audio: new Uint8Array(await readFile(audioPath)),
        audioMime: audio.mimeType,
      }, avatarConfig);
      let videoUrl = submitted.url;
      if (!videoUrl && submitted.id) {
        const deadline = Date.now() + 20 * 60 * 1000;
        while (Date.now() < deadline) {
          assertLive(id);
          await Bun.sleep(5000);
          const result = await pollAvatar(submitted.id, avatarConfig);
          if (result.status === "failed") throw new Error(result.error || "数字人生成失败");
          if (result.status === "done" && result.url) {
            videoUrl = result.url;
            break;
          }
        }
      }
      if (!videoUrl) throw new Error("数字人生成超时，请稍后重试");
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error(`下载数字人视频失败（${response.status}）`);
      const raw = join(directory, "avatar-raw.mp4");
      await writeFile(raw, new Uint8Array(await response.arrayBuffer()));
      const burned = await finishAvatarVideo({ video: raw, output: join(directory, fileName), width, height, subtitles, duration, aiLabel: input.aiLabel !== false });
      warnings.push(`数字人视频由 ${avatarConfig.provider === "did" ? "D-ID" : "自定义服务"} 生成`);
      if (subtitles.length) warnings.push(burned ? `已烧录 ${subtitles.length} 条口播字幕` : "未找到中文字体，字幕已跳过");
      if (input.aiLabel !== false) warnings.push(burned ? "已烧录「AI 生成」标识" : "未找到中文字体，AI 标识已跳过");
      rendered = true;
    } catch (cause) {
      warnings.push(`数字人服务不可用，已回退为静态口播：${cause instanceof Error ? cause.message : "未知错误"}`);
    }
  }

  if (!rendered) {
    const raw = join(directory, "talk-raw.mp4");
    await renderTalkVideo({
      portrait, audio: audioPath, duration, width, height, subtitles,
      output: raw,
    });
    if (input.aiLabel !== false) {
      await burnVideoLabel(raw, join(directory, fileName), width, height);
      warnings.push("已烧录「AI 生成」标识");
    } else {
      await rename(raw, join(directory, fileName));
    }
    warnings.push("当前为静态人物口播：画面轻微推近 + 语音 + 字幕，未做唇形同步");
  }
  warnings.push(`语音由 ${model.providerLabel} / ${model.label} 生成，时长 ${duration.toFixed(1)} 秒`);

  const output: VideoOutput = {
    ratio: input.ratio,
    width,
    height,
    label: `口播视频 ${input.ratio}`,
    path: fileName,
    url: `/api/ecommerce/assets/${id}/${fileName}`,
    kind: "video",
    duration: Math.round(duration * 10) / 10,
  };
  updateTask(id, { status: "succeeded", outputs: [output], warnings, error: null });
}

export function enqueueTalkTask(input: TalkInput, user: { id: number; username: string }) {
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db().run(
    "INSERT INTO ecommerce_tasks (id, type, user_id, username, status, recipe, request, assets, error, created_at, updated_at) VALUES (?, 'talk', ?, ?, 'queued', 'talk', ?, NULL, NULL, ?, ?)",
    [id, user.id, user.username, JSON.stringify({ ratio: input.ratio, subtitles: input.subtitles !== false, script: input.script.slice(0, 200) }), now, now],
  );
  scheduleTask(id, () => executeTalkTask(id, input), "口播任务");
  return { id, status: "queued" as const };
}

export interface BatchInput {
  csv: string;
  style?: "white" | "scene";
  sharedImage?: TaskInput["images"][number];
  scenePrompt?: string;
  providerId?: string;
  modelId?: string;
  targets?: { ratio?: string; width: number; height: number }[];
  aiLabel?: boolean;
  video?: {
    ratio?: "9:16" | "1:1" | "16:9";
    duration?: number;
    transition?: "none" | "fade" | "slide";
    subtitles?: boolean;
    bgm?: { data: string; mimeType: string };
  };
}

// ACT: 批量只接受平台常用规格，任意尺寸会让商品在画面中的比例失衡，也会让合成结果不可预期。
const batchSizes: OutputSpec[] = [
  { ratio: "1:1", width: 1200, height: 1200, label: "1:1 主图 1200" },
  { ratio: "1:1", width: 800, height: 800, label: "1:1 主图 800" },
  { ratio: "3:4", width: 1242, height: 1656, label: "3:4 小红书 1242×1656" },
  { ratio: "9:16", width: 1080, height: 1920, label: "9:16 抖音 1080×1920" },
  { ratio: "16:9", width: 1920, height: 1080, label: "16:9 横版 1920×1080" },
];

function normalizeBatchTargets(input?: BatchInput["targets"]) {
  const picked: OutputSpec[] = [];
  for (const item of Array.isArray(input) ? input : []) {
    if (!item || typeof item !== "object") continue;
    const width = Math.round(Number(item.width));
    const height = Math.round(Number(item.height));
    const preset = batchSizes.find(size => size.width === width && size.height === height);
    if (!preset || picked.some(size => size.width === preset.width && size.height === preset.height)) continue;
    picked.push(preset);
    if (picked.length === 4) break;
  }
  return picked.length ? picked : [batchSizes[0]];
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function saveBatchRequest(id: string, input: BatchInput, specs: OutputSpec[]) {
  const directory = taskDirectory(id);
  await mkdir(directory, { recursive: true });
  const shared = input.sharedImage;
  if (shared?.data) {
    const name = `shared-input.${extensionFor(shared.mimeType)}`;
    await writeFile(join(directory, name), Buffer.from(shared.data, "base64"));
  }
  if (input.video?.bgm?.data) {
    const extension = input.video.bgm.mimeType.includes("wav") ? "wav" : input.video.bgm.mimeType.includes("mp4") || input.video.bgm.mimeType.includes("m4a") ? "m4a" : "mp3";
    await writeFile(join(directory, `batch-bgm.${extension}`), Buffer.from(input.video.bgm.data, "base64"));
  }
  await writeFile(join(directory, "request.json"), JSON.stringify({
    csv: input.csv,
    style: input.style === "scene" ? "scene" : "white",
    scenePrompt: input.scenePrompt,
    providerId: input.providerId,
    modelId: input.modelId,
    targets: specs.map(spec => ({ ratio: spec.ratio, width: spec.width, height: spec.height })),
    aiLabel: input.aiLabel !== false,
    video: input.video ? { ratio: input.video.ratio, duration: input.video.duration, transition: input.video.transition, subtitles: input.video.subtitles } : undefined,
    rows: parseSkuCsv(input.csv).length,
  }));
}

async function executeBatchTask(id: string, input: BatchInput, options: { rows?: number[] } = {}) {
  if (input.video) return executeBatchVideoTask(id, input, options);
  const directory = taskDirectory(id);
  await mkdir(directory, { recursive: true });

  const items = parseSkuCsv(input.csv);
  if (!items.length) throw Object.assign(new Error("CSV 没有可解析的商品行"), { status: 400 });
  const style = input.style === "scene" ? "scene" : "white";
  const recipeId = style === "white" ? "packshot" : "lifestyle";
  const recipe = findRecipe(recipeId);
  const specs = normalizeBatchTargets(input.targets);
  await saveBatchRequest(id, input, specs);

  const previous = new Map(listBatchItems(id).map(item => [item.index, item]));
  // ACT: 断点续跑只重跑未成功的行；首次执行时给每一行建记录，便于历史里看到总数。
  const candidates = options.rows?.length
    ? options.rows
    : previous.size
    ? items.map((_, index) => index).filter(index => previous.get(index)?.status !== "succeeded")
    : items.map((_, index) => index);
  const targets = [...new Set(candidates)].filter(index => index >= 0 && index < items.length && previous.get(index)?.status !== "succeeded");
  if (!targets.length) throw Object.assign(new Error("没有需要重跑的行"), { status: 400 });
  for (let index = 0; index < items.length; index += 1) {
    if (!previous.has(index)) writeBatchItem(id, index, items[index].title, "pending", null, []);
  }

  const warnings: string[] = [];
  assertLive(id);
  updateTask(id, { status: "running", outputs: [], warnings, error: null });

  // ACT: 场景模式只生成一张底图（面积最大的规格），其余尺寸在本地裁切，避免尺寸翻倍带来的模型费用翻倍。
  const baseSpec = specs.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  const sceneModel = style === "scene" ? await pickSceneModel(input) : null;
  if (style === "scene" && !sceneModel) throw new Error("没有可用的图片生成模型");
  const degraded = !getConfig().matting.apiKey;
  const columns = specs.map(spec => `${spec.width}x${spec.height}`);
  const compressed = new Set<string>();
  const subjectRatios: { width: number; height: number }[] = [];
  const compliance: string[] = [];
  let subjectSkipped = 0;
  let purityChecked = false;

  for (let position = 0; position < targets.length; position += 1) {
    assertLive(id);
    const index = targets[position];
    const item = items[index];
    const sequence = String(index + 1).padStart(3, "0");
    const itemDirectory = join(directory, `item-${sequence}`);
    await mkdir(itemDirectory, { recursive: true });
    writeBatchItem(id, index, item.title, "running", null, []);
    try {
      let image = input.sharedImage;
      if (item.imageUrl) image = await downloadImage(item.imageUrl);
      if (!image) throw new Error("缺少商品图（CSV 无图片地址且未上传共享图）");
      const foreground = await prepareCutout(itemDirectory, image, []);
      // ACT: 只有真正拿到透明抠图才能测量主体边界；降级用原图时边界等于整张图，占比没有意义。
      const subjectBase = style === "white" && foreground.endsWith("cutout.png") ? await measureSubject(foreground) : null;
      if (style === "white" && !subjectBase) subjectSkipped += 1;
      let scene: string | null = null;
      if (style === "scene" && sceneModel) {
        const prompt = buildScenePrompt(recipe, { title: item.title, category: item.category, sellingPoints: item.points }, input.scenePrompt);
        const generated = await generateMedia(itemDirectory, "image", {
          providerId: sceneModel.providerId,
          modelId: sceneModel.modelId,
          prompt,
          ratio: baseSpec.ratio,
          outputDirectory: "scenes",
        }, AbortSignal.timeout(TASK_TIMEOUT));
        scene = generated[0] ? join(itemDirectory, generated[0].path) : null;
        if (!scene) throw new Error("场景生成失败");
      }

      const rowFiles: BatchItem["files"] = [];
      for (const spec of specs) {
        assertLive(id);
        const background = join(itemDirectory, `bg-${spec.width}x${spec.height}.png`);
        if (scene) {
          await runFfmpeg([
            "-i", scene,
            "-vf", `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase,crop=${spec.width}:${spec.height}`,
            "-frames:v", "1", background,
          ]);
        } else {
          await runFfmpeg(["-f", "lavfi", "-i", `color=c=white:s=${spec.width}x${spec.height}`, "-frames:v", "1", background]);
        }
        const name = `${spec.width}x${spec.height}.jpg`;
        await compose(background, foreground, spec, recipeId, join(itemDirectory, name), degraded, { aiLabel: input.aiLabel });
        if (await fitJpeg(join(itemDirectory, name), spec.maxBytes)) compressed.add(`${spec.width}×${spec.height}`);
        if (input.aiLabel !== false) await injectJpegComment(join(itemDirectory, name), "AI-generated content");
        if (style === "white") {
          if (!purityChecked) {
            const purity = await measureWhitePurity(join(itemDirectory, name));
            if (purity) {
              compliance.push(`白底纯度 ${purity.percent}%（${purity.pass ? "通过" : "偏低"}）`);
              purityChecked = true;
            }
          }
          if (subjectBase) subjectRatios.push(subjectRatio(subjectBase, spec, recipe.compose));
        }
        rowFiles.push({ width: spec.width, height: spec.height, path: `${sequence}/${name}` });
      }
      writeBatchItem(id, index, item.title, "succeeded", null, rowFiles);
    } catch (cause) {
      writeBatchItem(id, index, item.title, "failed", cause instanceof Error ? cause.message : "未知错误", []);
    }
    updateTask(id, { warnings: [...warnings, `进度 ${position + 1}/${targets.length}`] });
  }

  const stored = listBatchItems(id).sort((a, b) => a.index - b.index);
  const succeeded = stored.filter(item => item.status === "succeeded");
  const failedItems = stored.filter(item => item.status === "failed");
  if (!succeeded.length) throw new Error(`全部 SKU 生成失败：${failedItems.slice(0, 3).map(item => `${item.title}：${item.error ?? "未知错误"}`).join("；")}`);

  const files: Record<string, Uint8Array> = {};
  const manifest = [`folder,title,category,sellingPoints,${columns.join(",")}`];
  for (const item of succeeded) {
    const sequence = String(item.index + 1).padStart(3, "0");
    const source = items[item.index];
    const row = [csvCell(sequence), csvCell(source.title), csvCell(source.category), csvCell(source.points.join("|"))];
    for (const spec of specs) {
      const relative = `${sequence}/${spec.width}x${spec.height}.jpg`;
      const disk = join(directory, `item-${sequence}`, `${spec.width}x${spec.height}.jpg`);
      if (!existsSync(disk)) {
        row.push(csvCell(""));
        continue;
      }
      files[relative] = new Uint8Array(await readFile(disk));
      row.push(csvCell(relative));
    }
    manifest.push(row.join(","));
  }
  files["manifest.csv"] = new TextEncoder().encode(`\uFEFF${manifest.join("\n")}`);
  for (const entry of await readdir(directory).catch(() => [] as string[])) {
    if (/^batch-\d+\.zip$/.test(entry)) await unlink(join(directory, entry)).catch(() => {});
  }
  const zip = zipSync(files, { level: 6 });
  const fileName = `batch-${succeeded.length}.zip`;
  await writeFile(join(directory, fileName), zip);

  const sizeText = specs.map(spec => `${spec.width}×${spec.height}`).join("、");
  const first = specs[0];
  const failures = failedItems.map(item => `${item.title}：${item.error ?? "未知错误"}`);

  warnings.push(`成功 ${succeeded.length} 个，失败 ${failedItems.length} 个`);
  warnings.push(`每个 SKU 输出 ${specs.length} 个尺寸：${sizeText}`);
  if (compressed.size) warnings.push(`已按平台大小上限压缩：${[...compressed].join("、")}`);
  if (style === "white") {
    if (subjectRatios.length) {
      const text = formatSubject(subjectRatios);
      if (text) compliance.push(`主体占比 ${text}`);
      if (subjectSkipped) compliance.push(`${subjectSkipped} 行未抠图，未计入占比`);
    } else {
      compliance.push("未抠图（降级），无法校验主体占比");
    }
    if (compliance.length) warnings.push(...compliance.map(item => `【合规】${item}`));
  }
  if (failures.length) warnings.push(...failures.slice(0, 5));
  if (degraded) warnings.push("未配置抠图服务，商品按原图合成，边缘可能不干净");
  if (style === "scene") warnings.push(`场景模式共调用 ${succeeded.length} 次图片模型（每个 SKU 一张底图，多尺寸本地裁切）`);

  updateTask(id, {
    status: failedItems.length ? "partial" : "succeeded",
    outputs: [{
      ratio: first.ratio,
      width: first.width,
      height: first.height,
      label: `批量套图（${succeeded.length} 个 SKU · ${specs.length} 种尺寸）`,
      path: fileName,
      url: `/api/ecommerce/assets/${id}/${fileName}`,
    }],
    warnings,
    error: null,
  });
}

async function executeBatchVideoTask(id: string, input: BatchInput, options: { rows?: number[] } = {}) {
  const directory = taskDirectory(id);
  await mkdir(directory, { recursive: true });
  const items = parseSkuCsv(input.csv);
  if (!items.length) throw Object.assign(new Error("CSV 没有可解析的商品行"), { status: 400 });
  const video = input.video ?? {};
  const ratio: VideoInput["ratio"] = video.ratio === "1:1" || video.ratio === "16:9" ? video.ratio : "9:16";
  const duration = video.duration === 10 || video.duration === 15 ? video.duration : 5;
  await saveBatchRequest(id, input, []);

  const previous = new Map(listBatchItems(id).map(item => [item.index, item]));
  const candidates = options.rows?.length
    ? options.rows
    : previous.size
    ? items.map((_, index) => index).filter(index => previous.get(index)?.status !== "succeeded")
    : items.map((_, index) => index);
  const targets = [...new Set(candidates)].filter(index => index >= 0 && index < items.length && previous.get(index)?.status !== "succeeded");
  if (!targets.length) throw Object.assign(new Error("没有需要重跑的行"), { status: 400 });
  for (let index = 0; index < items.length; index += 1) {
    if (!previous.has(index)) writeBatchItem(id, index, items[index].title, "pending", null, []);
  }

  const warnings: string[] = [];
  assertLive(id);
  updateTask(id, { status: "running", outputs: [], warnings, error: null });

  const model = await pickVideoModel(input);
  const [width, height] = videoSizes[ratio];
  let bgmPath: string | undefined;
  if (video.bgm?.data) {
    const extension = video.bgm.mimeType.includes("wav") ? "wav" : video.bgm.mimeType.includes("mp4") || video.bgm.mimeType.includes("m4a") ? "m4a" : "mp3";
    bgmPath = join(directory, `batch-bgm.${extension}`);
    await writeFile(bgmPath, Buffer.from(video.bgm.data, "base64"));
  }
  const sharedWarnings = new Set<string>();

  for (let position = 0; position < targets.length; position += 1) {
    const index = targets[position];
    const item = items[index];
    const sequence = String(index + 1).padStart(3, "0");
    const itemDirectory = join(directory, `item-${sequence}`);
    await mkdir(itemDirectory, { recursive: true });
    writeBatchItem(id, index, item.title, "running", null, []);
    try {
      assertLive(id);
      let image = input.sharedImage;
      if (item.imageUrl) image = await downloadImage(item.imageUrl);
      if (!image) throw new Error("缺少商品图（CSV 无图片地址且未上传共享图）");
      const rowWarnings: string[] = [];
      const rendered = await renderVideo(itemDirectory, {
        images: [image],
        ratio,
        duration,
        transition: video.transition,
        // ACT: 每行的卖点直接作为卖点字幕，按镜头顺序出现，最多 3 条。
        subtitles: video.subtitles === false ? [] : item.points.slice(0, 3),
        providerId: input.providerId,
        modelId: input.modelId,
        bgmPath,
        aiLabel: input.aiLabel !== false,
      }, id, rowWarnings, model);
      rowWarnings.forEach(message => sharedWarnings.add(message));
      writeBatchItem(id, index, item.title, "succeeded", null, [{ width: rendered.width, height: rendered.height, path: `${sequence}/${rendered.fileName}` }]);
    } catch (cause) {
      writeBatchItem(id, index, item.title, "failed", cause instanceof Error ? cause.message : "未知错误", []);
    }
    updateTask(id, { warnings: [...warnings, `进度 ${position + 1}/${targets.length}`] });
  }

  const stored = listBatchItems(id).sort((a, b) => a.index - b.index);
  const succeeded = stored.filter(item => item.status === "succeeded");
  const failedItems = stored.filter(item => item.status === "failed");
  if (!succeeded.length) {
    throw new Error(`全部 SKU 生成失败：${failedItems.slice(0, 3).map(item => `${item.title}：${item.error ?? "未知错误"}`).join("；")}`);
  }

  const files: Record<string, Uint8Array> = {};
  const manifest = ["folder,title,category,sellingPoints,video"];
  for (const item of succeeded) {
    const sequence = String(item.index + 1).padStart(3, "0");
    const source = items[item.index];
    const relative = `${sequence}/video-${width}x${height}.mp4`;
    const disk = join(directory, `item-${sequence}`, `video-${width}x${height}.mp4`);
    if (!existsSync(disk)) {
      manifest.push([csvCell(sequence), csvCell(source.title), csvCell(source.category), csvCell(source.points.join("|")), csvCell("")].join(","));
      continue;
    }
    files[relative] = new Uint8Array(await readFile(disk));
    manifest.push([csvCell(sequence), csvCell(source.title), csvCell(source.category), csvCell(source.points.join("|")), csvCell(relative)].join(","));
  }
  files["manifest.csv"] = new TextEncoder().encode(`\uFEFF${manifest.join("\n")}`);
  for (const entry of await readdir(directory).catch(() => [] as string[])) {
    if (/^batch-\d+\.zip$/.test(entry)) await unlink(join(directory, entry)).catch(() => {});
  }
  const fileName = `batch-${succeeded.length}.zip`;
  await writeFile(join(directory, fileName), zipSync(files, { level: 6 }));

  const failures = failedItems.map(item => `${item.title}：${item.error ?? "未知错误"}`);
  const segments = Math.min(3, Math.max(1, Math.round(duration / 5)));
  warnings.push(`成功 ${succeeded.length} 个，失败 ${failedItems.length} 个`);
  warnings.push(`每个 SKU ${segments} 段视频，目标 ${duration} 秒，画幅 ${ratio}`);
  if (sharedWarnings.size) warnings.push(...[...sharedWarnings]);
  if (failures.length) warnings.push(...failures.slice(0, 5));

  updateTask(id, {
    status: failedItems.length ? "partial" : "succeeded",
    outputs: [{
      ratio,
      width,
      height,
      label: `批量视频（${succeeded.length} 个 SKU · ${duration} 秒）`,
      path: fileName,
      url: `/api/ecommerce/assets/${id}/${fileName}`,
      kind: "video",
    }],
    warnings,
    error: null,
  });
}

export function enqueueBatchTask(input: BatchInput, user: { id: number; username: string }) {
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db().run(
    "INSERT INTO ecommerce_tasks (id, type, user_id, username, status, recipe, request, assets, error, created_at, updated_at) VALUES (?, 'batch', ?, ?, 'queued', 'batch', ?, NULL, NULL, ?, ?)",
    [id, user.id, user.username, JSON.stringify({
      csv: input.csv,
      style: input.style === "scene" ? "scene" : "white",
      scenePrompt: input.scenePrompt,
      providerId: input.providerId,
      modelId: input.modelId,
      targets: normalizeBatchTargets(input.targets).map(spec => ({ ratio: spec.ratio, width: spec.width, height: spec.height })),
      aiLabel: input.aiLabel !== false,
      video: input.video ? { ratio: input.video.ratio, duration: input.video.duration, transition: input.video.transition, subtitles: input.video.subtitles } : undefined,
      rows: parseSkuCsv(input.csv).length,
    }), now, now],
  );
  scheduleTask(id, () => executeBatchTask(id, input), "批量任务");
  return { id, status: "queued" as const };
}

export function getBatchTask(id: string, user?: TaskViewer) {
  const row = db().query("SELECT * FROM ecommerce_tasks WHERE id = ? AND type = 'batch'").get(id) as TaskRow | null;
  if (!row || !canAccessTask(row, user)) return null;
  return rowToTask(row);
}

export async function resumeBatchTask(id: string, rows?: number[], user?: TaskViewer) {
  const row = db().query("SELECT * FROM ecommerce_tasks WHERE id = ? AND type = 'batch'").get(id) as TaskRow | null;
  if (!row || !canAccessTask(row, user)) throw Object.assign(new Error("批量任务不存在"), { status: 404 });
  if (row.status === "queued" || row.status === "running") throw Object.assign(new Error("任务正在执行，请稍后再试"), { status: 409 });

  const request = parseBatchRequest(row.request);
  if (!request.csv.trim()) throw Object.assign(new Error("该任务没有保存 CSV，无法续跑"), { status: 400 });
  const items = listBatchItems(id);
  if (!items.length) throw Object.assign(new Error("该任务没有行级记录，无法续跑"), { status: 400 });
  const requested = rows?.length ? rows : items.filter(item => item.status !== "succeeded").map(item => item.index);
  const targets = [...new Set(requested)]
    .filter(index => Number.isInteger(index))
    .filter(index => items.some(item => item.index === index && item.status !== "succeeded"));
  if (!targets.length) throw Object.assign(new Error("没有需要续跑的行"), { status: 400 });

  const directory = taskDirectory(id);
  const entries = await readdir(directory).catch(() => [] as string[]);
  let sharedImage: TaskInput["images"][number] | undefined;
  const sharedName = entries.find(name => name.startsWith("shared-input."));
  if (sharedName) {
    const mimeType = sharedName.endsWith(".jpg") ? "image/jpeg" : sharedName.endsWith(".webp") ? "image/webp" : "image/png";
    sharedImage = { data: (await readFile(join(directory, sharedName))).toString("base64"), mimeType };
  }
  let bgm: { data: string; mimeType: string } | undefined;
  const bgmName = entries.find(name => name.startsWith("batch-bgm."));
  if (bgmName) {
    const mimeType = bgmName.endsWith(".wav") ? "audio/wav" : bgmName.endsWith(".m4a") ? "audio/mp4" : "audio/mpeg";
    bgm = { data: (await readFile(join(directory, bgmName))).toString("base64"), mimeType };
  }

  const input: BatchInput = {
    csv: request.csv,
    style: request.style,
    scenePrompt: request.scenePrompt,
    providerId: request.providerId,
    modelId: request.modelId,
    targets: request.targets,
    aiLabel: request.aiLabel,
    video: request.video ? { ...request.video, bgm } : undefined,
    sharedImage,
  };
  updateTask(id, { status: "queued", outputs: [], warnings: [], error: null });
  scheduleTask(id, () => executeBatchTask(id, input, { rows: targets }), "批量续跑");
  return { id, status: "queued" as const, rows: targets.length };
}

export function cancelTask(id: string, user?: TaskViewer) {
  const row = getTaskRow(id);
  if (!row || !canAccessTask(row, user)) throw Object.assign(new Error("任务不存在"), { status: 404 });
  if (row.status !== "queued" && row.status !== "running") throw Object.assign(new Error("任务已结束，无需取消"), { status: 400 });
  cancelled.add(id);
  const now = Date.now();
  db().run("UPDATE ecommerce_tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", ["任务已取消", now, id]);
  db().run("UPDATE ecommerce_batch_items SET status = 'failed', error = ?, updated_at = ? WHERE task_id = ? AND status IN ('pending','running')", ["任务已取消", now, id]);
  return { id, status: "failed" as const };
}

export async function deleteTask(id: string, user?: TaskViewer) {
  const row = getTaskRow(id);
  if (!row || !canAccessTask(row, user)) throw Object.assign(new Error("任务不存在"), { status: 404 });
  if (row.status === "queued" || row.status === "running") throw Object.assign(new Error("任务正在执行，请先取消"), { status: 409 });
  db().run("DELETE FROM ecommerce_batch_items WHERE task_id = ?", [id]);
  db().run("DELETE FROM ecommerce_tasks WHERE id = ?", [id]);
  await rm(taskDirectory(id), { recursive: true, force: true }).catch(() => {});
  return { id };
}
