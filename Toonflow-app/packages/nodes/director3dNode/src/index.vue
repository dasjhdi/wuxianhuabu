<template>
  <nodeSkeleton v-bind="nodeProps" style="width: 372px">
    <div v-loading="modelLoading" class="directorContent nopan" :title="modelError || undefined">
      <div class="sceneCard" role="button" tabindex="0" aria-label="打开导演台" :aria-busy="modelLoading" @dblclick.stop @click.stop="openEditor" @keydown.enter.stop="openEditor">
        <img v-if="preview" class="scenePreview" :src="preview" alt="最后镜头" draggable="false" />
        <div class="sceneEmpty" :class="{ overlay: !!preview }">
          <icon-cube3d-sphere :size="34" stroke="1.2" aria-hidden="true" />
          <p>在3D空间中搭建场景并进行多视角截图</p>
          <button type="button" class="openButton" :disabled="modelLoading" @click.stop="openEditor">打开导演台</button>
        </div>
      </div>
      <div class="promptCard nopan nodrag nowheel">
        <referenceItem v-if="refList.length" v-model="refList" @preview="setReferencePreview" @remove="removeReference" />
        <promptInput v-model="promptModel" v-model:text="prompt" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" placeholder="描述想要搭建的场景，支持通过参考图创建" />
        <div class="promptFooter">
          <button type="button" class="footerButton" title="添加参考图 / 素材" aria-label="添加参考图或素材" @click.stop="addReference"><icon-plus :size="20" /></button>
          <span v-if="generating" class="generatingHint">AI 正在搭建场景…</span>
          <button type="button" class="sendButton" :disabled="!prompt.trim() || generating" :loading="generating" title="AI 搭建场景" aria-label="AI 搭建场景" @click.stop="submitPrompt"><icon-arrow-up :size="18" /></button>
        </div>
      </div>
    </div>
  </nodeSkeleton>
  <sceneEditor v-if="editing" v-model:anchors="anchors" v-model:prompt="prompt" v-model:model="model" v-model:lighting="lighting" v-model:sceneSettings="sceneSettings" v-model:shootingAnchorId="shootingAnchorId"
    :scene="scene" :result="selectedPlan" :models="models" :modelsLoading="modelsLoading" :addingMannequin="addingMannequin" :aiOpen="aiOpen"
    :backdropUrl="backdropUrl" :uploadingBackdrop="uploadingBackdrop" :resolveUrl="resolveAssetUrl" :canUndo="undoDepth > 0" :canRedo="redoDepth > 0" :uploadingModel="uploadingModel"
    :referenceImage="referenceImage" :referenceLabel="referenceLabel"
    :plans="plans" :selectedPlanId="data.selectedPlanId ?? ''" :tasks="tasks"
    :exportingVideo="exportingVideo" :exportingImage="exportingImage" :exportProgress="exportProgress"
    @exportVideo="exportVideo" @exportImage="exportImage" @exportAllAnchors="exportAllAnchors" @addMannequin="addMannequin"
    @exportContact="exportContactSheet" @applyPose="applyPose" @removeObject="removeObject" @addCrowd="addCrowd"
    @exportImageFile="exportImageFile" @addPrimitive="addPrimitive" @uploadBackdrop="uploadBackdrop" @uploadModel="uploadModel" @updateScene="updateScene"
    @updateObject="updateObject" @renameObject="renameObject" @duplicateObject="duplicateObject" @addKeyframe="addKeyframe" @removeTrack="removeTrack"
    @addProp="addProp" @addCameraKeyframe="addCameraKeyframe" @removeCameraKeyframe="removeCameraKeyframe" @removeObjectKeyframe="removeObjectKeyframe"
    @save="saveScene" @recognizeScene="recognizeScene"
    @undo="travelHistory('undo')" @redo="travelHistory('redo')"
    @selectPlan="data.selectedPlanId = $event" @loadModels="loadModels" @generate="generate" @editInstruction="setPrompt" @close="editing = false; aiOpen = false">
    <template #agent>
      <agentChat
        v-model:prompt="prompt"
        v-model:model="model"
        :messages="agentMessages"
        :plans="plans"
        :selectedPlanId="data.selectedPlanId ?? ''"
        :running="agentRunning"
        :status="agentStatus"
        :pending="pendingView"
        :confirmApply="confirmApply"
        :applying="applying"
        :models="models"
        :modelsLoading="modelsLoading"
        :disabled="addingMannequin"
        @update:confirmApply="confirmApply = $event"
        @send="generate"
        @stop="stopGenerate"
        @apply="applyPending"
        @discard="discardPending"
        @retry="retryInstruction"
        @clear="clearMessages"
        @suggest="suggestInstruction"
        @recognize="recognizeScene"
        @selectPlan="data.selectedPlanId = $event"
        @loadModels="loadModels">
        <template #input>
          <referenceItem v-if="refList.length" v-model="refList" @preview="setReferencePreview" @remove="removeReference" />
          <promptInput v-model="promptModel" v-model:text="prompt" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" placeholder="描述场景、人物走位和运镜要求" />
        </template>
      </agentChat>
    </template>
  </sceneEditor>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { IconArrowUp, IconCube3dSphere, IconPlus } from "@tabler/icons-vue";
import { ElLoading, ElMessage, ElMessageBox } from "element-plus";
import { nodeSkeleton, useNode, useNodeFiles, z, type NodeHandle, type NodeData, type NodeAiModel } from "@toonflow/nodes-scaffold/runtime";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import promptInput from "@toonflow/node-shared/promptInput";
import referenceItem from "@toonflow/node-shared/referenceItem";
import sceneEditor from "./sceneEditor.vue";
import { capturePreview, clearModelCache, createEmptyScene, createMannequinObject, createStage, defaultSceneSettings, disposeStage, getSceneLighting, migrateSceneBackground, preloadModelAssets, sceneSchema, type LightingSettings, type SceneDocument, type SceneObject, type SceneSettings } from "./scene";
import { findPosePreset } from "./posePresets";
import { createDirectorDraft } from "./agentTools";
import { directorPrompt } from "./agentPrompt";
import { anchorSchema, prepareMotion, sampleMotion, type CameraAnchor } from "./motion";
import { directorPlanSchema, prepareSceneAnimation, type DirectorPlan, type DirectorGeneration } from "./sceneAnimation";
import { mannequinJoints } from "./mannequin";
import { findMannequinPreset, mannequinPresetScale } from "./mannequinPresets";
import { propLabels, propSizes, type PropKind } from "./props";
import agentChat from "./agentChat.vue";
import type { AgentMessage, PendingApplyView } from "./agentTypes";
import { renderImage, renderVideo } from "./renderMedia";

type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
type Plan = z.infer<typeof directorPlanSchema>;
type PlanTrack = Plan["tracks"][number];
type PlanFrame = PlanTrack["frames"][number];
const modelDocumentSchema = z.strictObject({
  version: z.literal(1),
  scene: sceneSchema,
  plans: z.array(directorPlanSchema.safeExtend({ id: z.string().min(1), instruction: z.string().optional() })),
});
type ModelDocument = z.infer<typeof modelDocumentSchema>;
type ScenePatch = { background?: string };
type ObjectPatch = Partial<Pick<SceneObject, "name" | "position" | "rotation" | "scale" | "pose">> & { color?: string };
const modelFileLimit = 60 * 1024 * 1024;
defineOptions({
  inheritAttrs: false,
  icon: IconCube3dSphere,
  handles: [{ id: "in", type: "target", dataType: ["STRING", "IMAGE", "VIDEO"], label: "文本、图片、视频输入" }] satisfies NodeHandle[],
});
const { node, nodeProps, previewReady, ai, files, nodeEvent } = useNode({ label: "导演台" });
const vLoading = ElLoading.directive;
const { addNodes, findNode, getNodes, nodeTypes, removeNodes } = useVueFlow();
const mediaFiles = useNodeFiles();
const exportingVideo = ref(false);
const exportingImage = ref("");
const exportProgress = ref(0);
const exportController = new AbortController();
nodeEvent.on("delete", () => { if (exportingVideo.value || exportingImage.value) throw new Error("正在导出，请完成后再删除导演节点"); });
const data = computed(() => node.data as typeof node.data & {
  modelPath?: string;
  modelSnapshot?: ModelDocument;
  snapshotAssets?: string[];
  lighting?: LightingSettings;
  sceneSettings?: SceneSettings;
  prompt?: string;
  promptModel?: PromptModel;
  model?: string;
  anchors?: CameraAnchor[];
  shootingAnchorId?: string;
  selectedPlanId?: string;
  agentMessages?: AgentMessage[];
  agentConfirm?: boolean;
});
const { refList, referenceMentions, materialMentions, selectMaterialReference, selectAssetReference, setReferencePreview, removeReference } = useNodeReferences();
const promptModel = computed({ get: () => data.value.promptModel ?? [], set: (value: PromptModel) => { data.value.promptModel = value; } });
const anchors = computed({ get: () => data.value.anchors ?? [], set: (value: CameraAnchor[]) => { data.value.anchors = value; } });
const shootingAnchorId = computed({ get: () => data.value.shootingAnchorId ?? "", set: (value: string) => { data.value.shootingAnchorId = value; } });
const prompt = computed({ get: () => data.value.prompt ?? "", set: (value: string) => { data.value.prompt = value; } });
const model = computed({ get: () => data.value.model ?? "", set: (value: string) => { data.value.model = value; } });
// ACT: 左侧参考图卡直接取第一张图片输入，点击“识别场景图并搭建”时由 agent 读取同一张图重建白模。
const referenceImage = computed(() => {
  const item = refList.value.find(value => value.dataType === "IMAGE");
  const media = item?.value as { url?: string } | undefined;
  return media?.url ?? "";
});
const referenceLabel = computed(() => {
  const item = refList.value.find(value => value.dataType === "IMAGE");
  if (!item) return "";
  const label = findNode<NodeData>(item.source)?.data.label;
  return typeof label === "string" && label.trim() ? label.trim() : "参考图";
});
// ACT: 场景和动画只在节点内部持有，画布数据仅保存文件引用，避免拖动时遍历大量关键帧。
const modelDocument = shallowRef<ModelDocument>({ version: 1, scene: createEmptyScene(), plans: [] });
const plans = computed(() => modelDocument.value.plans);
const selectedPlan = computed(() => plans.value.find(plan => plan.id === data.value.selectedPlanId));
const scene = computed(() => modelDocument.value.scene);
const lighting = computed({ get: () => ({ ...getSceneLighting(scene.value), ...data.value.lighting }), set: (value: LightingSettings) => { data.value.lighting = value; } });
const sceneSettings = computed({ get: () => ({ ...defaultSceneSettings, ...data.value.sceneSettings }), set: (value: SceneSettings) => { data.value.sceneSettings = value; } });
const editing = ref(false);
// ACT: 卡片输入框发送后打开编辑器并展开 AI 面板，让用户在导演台里看到搭建进度。
const aiOpen = ref(false);
const tasks = ref<DirectorGeneration[]>([]);
const generating = computed(() => tasks.value.some(task => !task.error));
// ---------- 导演台 Agent 对话 ----------
type PendingApply = {
  id: string;
  messageId: string;
  instruction: string;
  scene: SceneDocument;
  plan?: DirectorPlan & { id: string; instruction?: string };
  sceneChanged: boolean;
  baseScene: SceneDocument;
  basePlanId: string;
  previewImage?: string;
  previewLighting: LightingSettings;
  previewSettings: SceneSettings;
  summary: string;
};
const agentMessages = ref<AgentMessage[]>(normalizeAgentMessages(data.value.agentMessages));
const agentRunning = ref(false);
const agentStatus = ref("");
const confirmApply = ref(data.value.agentConfirm === true);
const pendingApply = shallowRef<PendingApply | null>(null);
const pendingView = computed<PendingApplyView | null>(() => pendingApply.value
  ? {
      title: pendingApply.value.plan ? `待应用：${pendingApply.value.plan.name}` : "待应用：场景修改",
      detail: pendingApply.value.summary,
      thumb: pendingApply.value.previewImage,
    }
  : null);
let chatController: AbortController | undefined;
const applying = ref(false);
watch(confirmApply, value => { data.value.agentConfirm = value; });

function normalizeAgentMessages(value: unknown): AgentMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const message = item as Partial<AgentMessage>;
    if (!message || (message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string") return [];
    return [{
      id: typeof message.id === "string" ? message.id : crypto.randomUUID(),
      role: message.role,
      text: message.text.slice(0, 2000),
      time: typeof message.time === "number" ? message.time : Date.now(),
      // 刷新后未完成的运行/待确认状态不再有效，统一标为已停止，避免出现“永远转圈”的消息。
      status: message.status === "running" || message.status === "pending" ? "stopped" : message.status,
      error: typeof message.error === "string" ? message.error : undefined,
      instruction: typeof message.instruction === "string" ? message.instruction : undefined,
    }];
  }).slice(-30);
}
function persistMessages() {
  data.value.agentMessages = agentMessages.value.slice(-30);
}
function pushMessage(message: AgentMessage) {
  agentMessages.value = [...agentMessages.value, message].slice(-30);
}
function updateMessage(id: string, patch: Partial<AgentMessage>) {
  agentMessages.value = agentMessages.value.map(message => message.id === id ? { ...message, ...patch } : message);
}
// ACT: 生成草稿期间用户又改了场景时，草稿基线已失效，主动作废而不是等应用时报错。
watch(scene, value => {
  const pending = pendingApply.value;
  if (!pending || applying.value || value === pending.baseScene) return;
  pendingApply.value = null;
  updateMessage(pending.messageId, { status: "error", error: "场景已在其它操作中变更，本次草稿已失效，请重新生成。" });
  persistMessages();
});
const busy = computed(() => modelLoading.value || !!modelError.value || addingMannequin.value || exportingVideo.value || generating.value);
const modelsLoading = ref(false);
const models = ref<NodeAiModel[]>([]);
const selectedModel = computed(() => models.value.find(item => JSON.stringify([item.providerId, item.modelId]) === model.value));
const preview = ref("");
let previewVersion = 0;
const modelLoading = ref(true);
const modelError = ref("");
const addingMannequin = ref(false);
const uploadingModel = ref(false);
let modelSaving = Promise.resolve();
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
  chatController?.abort(new Error("导演节点已关闭"));
  exportController.abort(new Error("导演节点已关闭，导出已停止"));
  for (const url of assetUrls.values()) void url.then(value => URL.revokeObjectURL(value), () => {});
  assetUrls.clear();
  clearModelCache();
});

// ---------- 素材路径解析 ----------
// ACT: 上传接口返回的是工作区相对路径（assets/<节点>/<uuid>.ext），不能直接交给加载器当 URL；统一读成 blob URL 再给贴图 / 模型加载器。
const assetUrls = new Map<string, Promise<string>>();
function resolveAssetUrl(path: string) {
  let task = assetUrls.get(path);
  if (!task) {
    task = files.getWorkspaceFiles().read(path).then(buffer => {
      if (disposed) throw new Error("导演节点已关闭");
      return URL.createObjectURL(new Blob([buffer]));
    });
    assetUrls.set(path, task);
    task.catch(() => { if (assetUrls.get(path) === task) assetUrls.delete(path); });
  }
  return task;
}
const backdropUrl = ref("");
watch(() => sceneSettings.value.backdropPath, async path => {
  if (!path) { backdropUrl.value = ""; return; }
  try {
    const url = await resolveAssetUrl(path);
    if (!disposed && sceneSettings.value.backdropPath === path) backdropUrl.value = url;
  } catch (error) {
    if (!disposed && sceneSettings.value.backdropPath === path) ElMessage.error(`全景背景读取失败：${error instanceof Error ? error.message : "文件不存在"}`);
  }
}, { immediate: true });

async function resolveScene(document: SceneDocument): Promise<SceneDocument> {
  const models = document.objectList.filter(object => object.model);
  if (!models.length) return document;
  const urls = await Promise.all(models.map(object => resolveAssetUrl(object.model!.path)));
  return { ...document, objectList: document.objectList.map(object => {
    const index = models.indexOf(object);
    return index < 0 ? object : { ...object, model: { path: urls[index]! } };
  }) };
}
async function resolveSettings(settings: SceneSettings): Promise<SceneSettings> {
  if (!settings.backdropPath) return settings;
  return { ...settings, backdropPath: await resolveAssetUrl(settings.backdropPath) };
}

function getModelPath() {
  if (!node.id || /[\\/]/.test(node.id) || node.id === "." || node.id === "..") throw new Error("节点 ID 不能作为文件夹名称");
  return `assets/${node.id}/model.json`;
}

let modelDirectoryReady = false;
async function writeModel(workspaceFiles: ReturnType<typeof files.getWorkspaceFiles>, value: ModelDocument) {
  const path = getModelPath();
  // 目录只需创建一次；之后每次保存不再重复请求 mkdir（目录已存在时接口返回 409）。
  if (!modelDirectoryReady) {
    for (const directory of ["assets", `assets/${node.id}`]) {
      await workspaceFiles.mkdir(directory).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
        if (error.response?.data?.data?.code !== "EEXIST") throw error;
      });
    }
    modelDirectoryReady = true;
  }
  await workspaceFiles.writeJson(path, value);
  return path;
}

// ACT: 复制 / 粘贴节点时把模型与背景图一并复制到新节点目录，原节点被删除后副本仍然完整；读不到源文件时保留原路径。
async function copyAsset(workspaceFiles: ReturnType<typeof files.getWorkspaceFiles>, path: string) {
  if (!path.startsWith("assets/") || path.startsWith(`assets/${node.id}/`)) return path;
  try {
    const target = `assets/${node.id}/${crypto.randomUUID()}${path.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0] ?? ""}`;
    await workspaceFiles.write(target, await workspaceFiles.read(path), true);
    return target;
  } catch {
    return path;
  }
}

async function loadModel() {
  modelLoading.value = true;
  modelError.value = "";
  try {
    const { modelPath, modelSnapshot, snapshotAssets = [] } = data.value;
    if (!modelPath && !modelSnapshot) return;
    const workspaceFiles = files.getWorkspaceFiles();
    if (modelPath && modelPath !== getModelPath()) throw new Error("导演台模型文件路径无效");
    const value = modelDocumentSchema.parse(modelSnapshot ?? await workspaceFiles.readJson(modelPath!));
    if (disposed) return;
    // 复制、跨画布粘贴时只传递一次快照，写入新节点目录成功后才移除快照。
    if (modelSnapshot) {
      const copies = new Map<string, string>();
      for (const path of [...new Set([...snapshotAssets, ...value.scene.objectList.flatMap(object => object.model ? [object.model.path] : [])])]) {
        copies.set(path, await copyAsset(workspaceFiles, path));
      }
      if (disposed) return;
      value.scene = sceneSchema.parse({
        ...value.scene,
        objectList: value.scene.objectList.map(object => object.model && copies.has(object.model.path) ? { ...object, model: { path: copies.get(object.model.path)! } } : object),
      });
      const { backdropPath } = sceneSettings.value;
      if (backdropPath && copies.has(backdropPath)) sceneSettings.value = { ...sceneSettings.value, backdropPath: copies.get(backdropPath) };
      const path = await writeModel(workspaceFiles, value);
      if (disposed) return;
      data.value.modelPath = path;
      delete data.value.modelSnapshot;
      delete data.value.snapshotAssets;
    }
    value.scene = migrateSceneBackground(value.scene);
    modelDocument.value = value;
    undoStack.length = 0;
    redoStack.length = 0;
    undoDepth.value = 0;
    redoDepth.value = 0;
    if (!selectedPlan.value) data.value.selectedPlanId = value.plans[0]?.id;
  } catch (error) {
    modelError.value = error instanceof Error ? error.message : "模型文件读取失败";
    if (!disposed) ElMessage.error(`导演台加载失败：${modelError.value}`);
  } finally {
    modelLoading.value = false;
  }
}

let modelReady = loadModel();
let starterStageTask: Promise<void> | undefined;

// ACT: 新建节点第一次打开时给一个可直接开拍的基础舞台：人物站在原点，机位在左前方取景。
async function seedStarterStage() {
  if (data.value.modelPath || data.value.modelSnapshot) return;
  const current = modelDocument.value;
  if (current.scene.objectList.length || current.plans.length || anchors.value.length) return;
  const mannequin = createMannequinObject(crypto.randomUUID());
  mannequin.name = "人物 1";
  // ACT: 初始机位正对人物正面（人偶默认面向 +Z），机位略高于胸口平视取景，打开即是可用的正面构图。
  const anchor = anchorSchema.parse({
    name: "机位 1",
    time: 0,
    camera: { position: { x: 0, y: 1.15, z: 3 }, fov: 45, near: 0.1, far: 1000 },
    controls: { target: { x: 0, y: 0.95, z: 0 } },
  });
  const scene = sceneSchema.parse({
    ...current.scene,
    sceneConfig: {
      ...current.scene.sceneConfig,
      camera: { ...current.scene.sceneConfig.camera, position: { x: 4.8, y: 2.9, z: 5.8 }, fov: 50 },
      controls: { target: { x: 0, y: 1, z: 1.4 } },
    },
    objectList: [mannequin],
  });
  const value: ModelDocument = { version: 1, scene, plans: [] };
  // 先落到内存，写盘失败也能立即进入编辑器搭建。
  modelDocument.value = value;
  data.value.anchors = [anchor];
  data.value.shootingAnchorId = anchor.id;
  undoStack.length = 0;
  redoStack.length = 0;
  undoDepth.value = 0;
  redoDepth.value = 0;
  try {
    const workspaceFiles = files.getWorkspaceFiles();
    const path = await writeModel(workspaceFiles, value);
    if (!disposed) data.value.modelPath = path;
  } catch (error) {
    if (!disposed) ElMessage.warning(`初始舞台保存失败：${error instanceof Error ? error.message : "无法写入工作区"}，本次仍可继续搭建`);
  }
}

async function ensureStarterStage() {
  starterStageTask ??= seedStarterStage();
  await starterStageTask;
}

async function openEditor() {
  if (modelError.value) modelReady = loadModel();
  await modelReady;
  if (disposed || modelError.value) return;
  await ensureStarterStage();
  if (!disposed) editing.value = true;
}

// ---------- 文档提交与撤销 ----------
const undoStack: ModelDocument[] = [];
const redoStack: ModelDocument[] = [];
const undoDepth = ref(0);
const redoDepth = ref(0);

// ACT: 场景与方案统一走串行保存；mutate 收到深拷贝文档，返回新文档后整体落盘，并把上一版压入撤销栈。
async function updateModelDocument(mutate: (document: ModelDocument) => ModelDocument, failureMessage = "场景更新失败") {
  if (modelLoading.value || modelError.value) throw new Error("导演台模型尚未加载");
  const workspaceFiles = files.getWorkspaceFiles();
  const saving = modelSaving.then(async () => {
    if (disposed) return;
    const previous = modelDocument.value;
    const value = mutate(structuredClone(previous));
    value.scene = sceneSchema.parse(value.scene);
    const path = await writeModel(workspaceFiles, value);
    if (disposed) return;
    undoStack.push(previous);
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
    undoDepth.value = undoStack.length;
    redoDepth.value = 0;
    modelDocument.value = value;
    data.value.modelPath = path;
    if (!value.plans.some(plan => plan.id === data.value.selectedPlanId)) data.value.selectedPlanId = value.plans[0]?.id;
  });
  modelSaving = saving.catch(() => {});
  await saving;
}

// ACT: 撤销 / 重做只回退场景与方案文档，机位、光照等画布数据由画布自身的历史负责；AI 生成成功后以新结果为基线清空栈。
async function travelHistory(direction: "undo" | "redo") {
  if (busy.value || uploadingModel.value) return;
  const from = direction === "undo" ? undoStack : redoStack;
  const to = direction === "undo" ? redoStack : undoStack;
  const target = from.pop();
  if (!target) return;
  undoDepth.value = undoStack.length;
  redoDepth.value = redoStack.length;
  const workspaceFiles = files.getWorkspaceFiles();
  const saving = modelSaving.then(async () => {
    if (disposed) return;
    try {
      const value: ModelDocument = { ...structuredClone(target), scene: sceneSchema.parse(target.scene) };
      const path = await writeModel(workspaceFiles, value);
      if (disposed) return;
      to.push(modelDocument.value);
      modelDocument.value = value;
      data.value.modelPath = path;
      if (!value.plans.some(plan => plan.id === data.value.selectedPlanId)) data.value.selectedPlanId = value.plans[0]?.id;
      ElMessage.success(direction === "undo" ? "已撤销上一步" : "已重做");
    } catch (error) {
      from.push(target);
      if (!disposed) ElMessage.error(error instanceof Error ? error.message : "历史回退失败");
    } finally {
      if (!disposed) { undoDepth.value = undoStack.length; redoDepth.value = redoStack.length; }
    }
  });
  modelSaving = saving.catch(() => {});
  await saving;
}

function nextSpawnX(objectList: SceneObject[]) {
  if (!objectList.length) return 0;
  const occupied = objectList.map(object => Math.round(object.position.x * 2) / 2);
  let x = 0;
  while (occupied.some(value => Math.abs(value - x) < 0.5)) x += 1.5;
  return x;
}

// ACT: 墙体、沙发等宽物件按自身宽度排到现有内容右侧，避免新道具和已有物体中心重叠。
function objectWidth(object: SceneObject) {
  if (object.prop) return propSizes[object.prop].width;
  const width = object.geometry.width;
  return typeof width === "number" && width > 0 ? width : 1;
}
function nextSpawnXFor(objectList: SceneObject[], width: number) {
  if (!objectList.length) return 0;
  const right = Math.max(...objectList.map(object => object.position.x + objectWidth(object) / 2));
  return Math.round((right + width / 2 + 0.4) * 100) / 100;
}

async function addMannequin(payload?: { pose?: string; preset?: string }) {
  if (modelLoading.value || modelError.value || addingMannequin.value || exportingVideo.value || exportingImage.value || tasks.value.some(task => !task.error)) return;
  addingMannequin.value = true;
  try {
    await updateModelDocument(document => {
      const scene = document.scene;
      const object = createMannequinObject(crypto.randomUUID());
      const body = findMannequinPreset(payload?.preset);
      if (body) {
        object.name = body.name;
        object.scale = mannequinPresetScale(body);
      }
      const preset = payload?.pose ? findPosePreset(payload.pose) : undefined;
      if (preset && Object.keys(preset.pose).length) object.pose = preset.pose;
      object.position.x = nextSpawnX(scene.objectList);
      const objectList = [...scene.objectList, object];
      const sceneConfig = scene.objectList.length ? scene.sceneConfig : {
        ...scene.sceneConfig,
        camera: { ...scene.sceneConfig.camera, position: { x: 3, y: 2.2, z: 4 } },
        controls: { target: { x: 0, y: 0.9, z: 0 } },
      };
      return { ...document, scene: { ...scene, objectList, sceneConfig } };
    }, "人偶添加失败");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "人偶添加失败");
  } finally {
    addingMannequin.value = false;
  }
}

async function addCrowd(options: { rows: number; cols: number; gap: number; facing: "center" | "fixed"; colored: boolean }) {
  if (modelLoading.value || modelError.value) return;
  const count = options.rows * options.cols;
  const room = 200 - scene.value.objectList.length;
  if (room < count) return void ElMessage.error(`场景物体上限 200，当前 ${scene.value.objectList.length} 个，最多还能添加 ${Math.max(0, room)} 个`);
  try {
    await updateModelDocument(document => {
      const palette = ["#c7a77b", "#a1887f", "#8d6e63", "#bcaaa4", "#795548", "#607d8b", "#ef9a9a", "#90caf9"];
      const objectList = [...document.scene.objectList];
      const startX = -((options.cols - 1) * options.gap) / 2;
      const startZ = 2.5 - ((options.rows - 1) * options.gap) / 2;
      for (let row = 0; row < options.rows; row += 1) {
        for (let column = 0; column < options.cols; column += 1) {
          const x = startX + column * options.gap;
          const z = startZ + row * options.gap;
          const object = createMannequinObject(crypto.randomUUID());
          object.name = "群众";
          object.position = { x, y: 0, z };
          if (options.facing === "center" && (Math.abs(x) > 0.01 || Math.abs(z) > 0.01)) {
            object.rotation = { rotationX: 0, rotationY: Math.atan2(-x, -z), rotationZ: 0 };
          }
          if (options.colored) object.material.color = palette[Math.floor(Math.random() * palette.length)]!;
          objectList.push(object);
        }
      }
      return { ...document, scene: { ...document.scene, objectList } };
    }, "群众阵列添加失败");
    ElMessage.success(`已添加 ${count} 个群众人偶`);
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "群众阵列添加失败");
  }
}

async function applyPose(objectId: string, poseName: string) {
  const preset = findPosePreset(poseName);
  if (!preset) return;
  try {
    await updateModelDocument(document => {
      const objectList = document.scene.objectList.map(object => {
        if (object.threeJsonId !== objectId || object.objType !== "mannequin") return object;
        const next = { ...object };
        if (Object.keys(preset.pose).length) next.pose = preset.pose;
        else delete next.pose;
        return next;
      });
      return { ...document, scene: { ...document.scene, objectList } };
    }, "姿势应用失败");
    ElMessage.success(`已应用姿势「${poseName}」`);
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "姿势应用失败");
  }
}

async function removeObject(objectId: string) {
  try {
    await updateModelDocument(document => ({
      ...document,
      scene: { ...document.scene, objectList: document.scene.objectList.filter(object => object.threeJsonId !== objectId) },
      plans: document.plans.map(plan => ({ ...plan, tracks: plan.tracks.filter(track => track.objectId !== objectId) })),
    }), "物体删除失败");
    ElMessage.success("物体已删除，相关动画轨道已同步清理");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "物体删除失败");
  }
}

// ACT: 属性面板编辑 —— 每次提交整体校验场景后落盘，编辑器按新文档原位刷新舞台。
async function updateObject(objectId: string, patch: ObjectPatch) {
  try {
    await updateModelDocument(document => ({
      ...document,
      scene: {
        ...document.scene,
        objectList: document.scene.objectList.map(object => {
          if (object.threeJsonId !== objectId) return object;
          const { color, ...rest } = patch;
          const next: SceneObject = { ...object, ...rest };
          if (color) next.material = { ...object.material, color };
          return next;
        }),
      },
    }), "物体属性更新失败");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "物体属性更新失败");
  }
}

async function updateScene(patch: ScenePatch) {
  try {
    await updateModelDocument(document => ({
      ...document,
      scene: { ...document.scene, sceneConfig: { ...document.scene.sceneConfig, scene: { background: patch.background ?? document.scene.sceneConfig.scene.background } } },
    }), "场景设置更新失败");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "场景设置更新失败");
  }
}

async function renameObject(objectId: string, name: string) {
  const value = name.trim().slice(0, 60);
  if (!value) return;
  await updateObject(objectId, { name: value });
}

// ACT: 复制物体 —— 在原物体旁生成副本，姿势、材质、缩放一并复制，动画轨道不复制。
async function duplicateObject(objectId: string) {
  try {
    await updateModelDocument(document => {
      const source = document.scene.objectList.find(item => item.threeJsonId === objectId);
      if (!source) throw new Error("物体不存在，无法复制");
      if (document.scene.objectList.length >= 200) throw new Error("场景物体上限 200");
      const copy = structuredClone(source);
      copy.threeJsonId = crypto.randomUUID();
      copy.name = `${source.name ?? primitiveNames[source.objType as keyof typeof primitiveNames] ?? "物体"} 副本`.slice(0, 60);
      copy.position = { ...source.position, x: source.position.x + 1 };
      return { ...document, scene: { ...document.scene, objectList: [...document.scene.objectList, copy] } };
    }, "物体复制失败");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "物体复制失败");
  }
}

// ---------- 上传模型 ----------
function modelObjectName(file: File) {
  return (file.name.replace(/\.[^.]+$/, "").trim() || "模型").slice(0, 60);
}

// ACT: 先解析成功再写入场景，坏文件不会把舞台弄挂；.gltf 只支持内嵌资源的单文件，推荐 .glb。
async function uploadModel(file: File, objectId?: string) {
  const extension = file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? "";
  if (!["glb", "gltf"].includes(extension)) return void ElMessage.error("请上传 .glb 或 .gltf 模型文件");
  if (!file.size) return void ElMessage.error("模型文件为空");
  if (file.size > modelFileLimit) return void ElMessage.error("模型文件不能超过 60 MB");
  if (uploadingModel.value || modelLoading.value || modelError.value) return;
  if (!objectId && scene.value.objectList.length >= 200) return void ElMessage.error("场景物体上限 200");
  uploadingModel.value = true;
  try {
    const path = await mediaFiles.uploadFile(node.id, file);
    const url = await resolveAssetUrl(path);
    await preloadModelAssets({ ...createEmptyScene(), objectList: [{ threeJsonId: "probe", name: "probe", objType: "model", geometry: {}, model: { path: url }, position: { x: 0, y: 0, z: 0 }, material: { type: "standard", color: "#ffffff" } }] });
    if (disposed) return;
    await updateModelDocument(document => {
      const objectList = objectId
        ? document.scene.objectList.map(object => object.threeJsonId === objectId && object.model ? { ...object, model: { path } } : object)
        : [...document.scene.objectList, {
            threeJsonId: crypto.randomUUID(), name: modelObjectName(file), objType: "model" as const, geometry: {}, model: { path },
            position: { x: nextSpawnX(document.scene.objectList), y: 0, z: 0 }, material: { type: "standard" as const, color: "#ffffff" },
          }];
      return { ...document, scene: { ...document.scene, objectList } };
    }, objectId ? "模型更换失败" : "模型添加失败");
    ElMessage.success(objectId ? "模型已更换" : `已添加模型「${modelObjectName(file)}」`);
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? `模型加载失败：${error.message}` : "模型加载失败");
  } finally {
    uploadingModel.value = false;
  }
}

nodeEvent.on("copy", async () => {
  await nodeEvent.emit("save");
  if (modelError.value) throw new Error(`导演台模型未加载，无法复制：${modelError.value}`);
  const backdrop = sceneSettings.value.backdropPath;
  return { modelPath: undefined, modelSnapshot: modelDocument.value, snapshotAssets: backdrop ? [backdrop] : [] };
});

nodeEvent.on("save", async (reason) => {
  await modelReady;
  let pending: Promise<void>;
  do {
    pending = modelSaving;
    await pending;
  } while (pending !== modelSaving);
  if (reason === "reload" && (exportingVideo.value || exportingImage.value || tasks.value.some(task => !task.error))) {
    throw new Error("导演台正在生成或导出，请完成后再刷新节点");
  }
});

async function exportToCanvas(kind: "image" | "video", key: string, aspect: number, render: (signal: AbortSignal) => Promise<File>) {
  if (kind === "video" ? exportingVideo.value : exportingImage.value) return;
  const type = `remote-${kind}Node`;
  if (!nodeTypes?.value?.[type]) return void ElMessage.error(`请先启用${kind === "image" ? "图片" : "视频"}节点插件`);
  if (kind === "video") { exportingVideo.value = true; exportProgress.value = 0; }
  else exportingImage.value = key;
  const id = crypto.randomUUID();
  let exportNode: ReturnType<typeof findNode<NodeData & { exportProgress?: number }>>;
  let discarded = false;
  let committed = false;
  let uploadStarted = false;
  let stopWatching = () => {};
  let workspaceFiles: ReturnType<typeof files.getWorkspaceFiles> | undefined;
  function addExportNode(label: string) {
    const width = 240 * aspect + 18;
    const x = node.computedPosition.x + (node.dimensions.width || 320) + 80;
    let y = node.computedPosition.y;
    for (const other of [...getNodes.value].sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
      const position = other.computedPosition;
      if (position.x < x + width && position.x + (other.dimensions.width || 320) > x && position.y < y + 320 && position.y + (other.dimensions.height || 300) > y) {
        y = position.y + (other.dimensions.height || 300) + 24;
      }
    }
    addNodes({ id, type, position: { x, y }, data: { label, outputs: {} } });
    return findNode(id)!;
  }
  try {
    workspaceFiles = files.getWorkspaceFiles();
    if (kind === "video") {
      exportNode = addExportNode(selectedPlan.value?.name ?? "视频");
      // ACT: 导出进度只在当前运行中使用，不能写入画布或复制到另一个节点。
      Object.defineProperty(exportNode.data, "exportProgress", { value: 0, writable: true, configurable: true });
      stopWatching = watch([() => findNode(id), exportProgress], ([current, progress]) => {
        if (current !== exportNode) discarded = true;
        if (!discarded) exportNode!.data.exportProgress = progress;
      }, { flush: "sync" });
    }
    const file = await render(exportController.signal);
    exportController.signal.throwIfAborted();
    if (discarded) return;
    uploadStarted = true;
    const path = await mediaFiles.uploadFile(id, file);
    exportController.signal.throwIfAborted();
    if (discarded) return;
    if (findNode(node.id) !== node || !nodeTypes?.value?.[type]) throw new Error("画布节点已变化，请重新导出");
    exportNode ??= addExportNode(file.name.replace(/\.[^.]+$/, ""));
    // 更新已有输出对象，让已挂载的视频节点及连接它的节点同步收到结果。
    (exportNode.data.outputs ??= {})[kind] = {
      dataType: kind === "image" ? "IMAGE" : "VIDEO", value: { url: path, mimeType: file.type },
    };
    committed = true;
    if (kind === "video") exportProgress.value = 100;
    ElMessage.success(`${kind === "image" ? "图片" : "视频"}已导出到画布`);
  } catch (error) {
    if (!disposed && !discarded) ElMessage.error(error instanceof Error ? error.message : "导出失败，请重试");
    if (exportNode && findNode(id) === exportNode) removeNodes(id);
  } finally {
    stopWatching();
    if (exportNode) delete exportNode.data.exportProgress;
    if (uploadStarted && !committed) {
      try { await workspaceFiles!.remove(`assets/${id}`, true); }
      catch (cleanupError) {
        const code = (cleanupError as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code;
        if (!disposed && code !== "ENOENT") ElMessage.error("导出中断，临时素材清理失败");
      }
    }
    if (kind === "video") exportingVideo.value = false;
    else exportingImage.value = "";
  }
}

function exportVideo(aspect: number) {
  const plan = selectedPlan.value;
  if (!plan) return;
  return exportToCanvas("video", "video", aspect, async signal => {
    const [resolved, settings] = await Promise.all([resolveScene(scene.value), resolveSettings(sceneSettings.value)]);
    return renderVideo(resolved, plan, aspect, signal, value => { exportProgress.value = value; }, lighting.value, settings);
  });
}

// ACT: 时间轴截图 —— 编辑器把当前画面渲染成 PNG 后直接走既有导出管线。
function exportImageFile(file: File, aspect: number) {
  return exportToCanvas("image", `shot-${Date.now()}`, aspect, async () => file);
}

// ACT: 背景图放在导演节点自己的素材目录下，节点删除时随目录一起清理，不再产生孤儿文件。
const uploadingBackdrop = ref(false);
async function uploadBackdrop(file: File) {
  uploadingBackdrop.value = true;
  try {
    getModelPath();
    const path = await mediaFiles.uploadFile(node.id, file);
    sceneSettings.value = { ...sceneSettings.value, backdropPath: path, backdropEnabled: true };
    ElMessage.success("全景背景已上传并启用");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "背景图上传失败");
  } finally {
    uploadingBackdrop.value = false;
  }
}

const primitiveNames = { box: "长方体", sphere: "球体", cylinder: "圆柱", cone: "圆锥", torus: "圆环" } as const;
const primitiveGeometry = {
  box: { width: 1, height: 1, depth: 1 },
  sphere: { radius: 0.5 },
  cylinder: { radiusTop: 0.4, radiusBottom: 0.4, height: 1 },
  cone: { radius: 0.5, height: 1 },
  torus: { radius: 0.5, tube: 0.15 },
} as const;

async function addPrimitive(kind: keyof typeof primitiveNames) {
  try {
    await updateModelDocument(document => {
      const first = !document.scene.objectList.length;
      return {
        ...document,
        scene: {
          ...document.scene,
          sceneConfig: first ? { ...document.scene.sceneConfig, camera: { ...document.scene.sceneConfig.camera, position: { x: 3, y: 2.2, z: 4 } }, controls: { target: { x: 0, y: 0.5, z: 0 } } } : document.scene.sceneConfig,
          objectList: [...document.scene.objectList, {
            threeJsonId: crypto.randomUUID(),
            name: primitiveNames[kind],
            objType: kind,
            geometry: { ...primitiveGeometry[kind] },
            position: { x: nextSpawnX(document.scene.objectList), y: 0.5, z: 0 },
            material: { type: "standard", color: "#8a8f98", roughness: 0.7 },
          }],
        },
      };
    }, "几何体添加失败");
    ElMessage.success(`已添加${primitiveNames[kind]}`);
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "几何体添加失败");
  }
}

// ACT: 内置白模道具与几何体共用场景结构，落盘后由舞台按 prop 字段生成对应组件。
async function addProp(kind: PropKind) {
  if (modelLoading.value || modelError.value) return;
  if (scene.value.objectList.length >= 200) return void ElMessage.error("场景物体上限 200");
  try {
    await updateModelDocument(document => {
      const first = !document.scene.objectList.length;
      return {
        ...document,
        scene: {
          ...document.scene,
          sceneConfig: first ? { ...document.scene.sceneConfig, camera: { ...document.scene.sceneConfig.camera, position: { x: 4, y: 2.4, z: 5 } }, controls: { target: { x: 0, y: 0.9, z: 0 } } } : document.scene.sceneConfig,
          objectList: [...document.scene.objectList, {
            threeJsonId: crypto.randomUUID(),
            name: propLabels[kind],
            objType: "prop" as const,
            prop: kind,
            geometry: {},
            position: { x: nextSpawnXFor(document.scene.objectList, propSizes[kind].width), y: 0, z: 0 },
            material: { type: "standard" as const, color: "#b9bec7", roughness: 0.72 },
          }],
        },
      };
    }, "道具添加失败");
    ElMessage.success(`已添加${propLabels[kind]}`);
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "道具添加失败");
  }
}

function exportImage(anchor: CameraAnchor, aspect: number, time: number) {
  const index = anchors.value.findIndex(item => item.id === anchor.id) + 1;
  const name = anchor.name?.trim() || `关键帧${index}`;
  return exportToCanvas("image", anchor.id, aspect, async signal => {
    const [resolved, settings] = await Promise.all([resolveScene(scene.value), resolveSettings(sceneSettings.value)]);
    const file = await renderImage(resolved, anchor, aspect, time, signal, selectedPlan.value, lighting.value, settings);
    return new File([file], `${name}.png`, { type: file.type });
  });
}

// ACT: 一键把全部机位按顺序导出为画布图片节点，供后续接图片 / 视频生成节点做多视角参考。
async function exportAllAnchors(aspect: number) {
  if (exportingImage.value || exportingVideo.value) return;
  const list = anchors.value;
  if (!list.length) return void ElMessage.warning("请先添加机位");
  for (const [index, anchor] of list.entries()) {
    if (disposed) return;
    await exportImage(anchor, aspect, anchor.time ?? 0);
    if (exportingImage.value) return;
    if (index < list.length - 1) await new Promise(resolve => setTimeout(resolve, 120));
  }
  ElMessage.success(`已导出 ${list.length} 个机位到画布`);
}

// ACT: 多机位宫格 —— 用前 N 个机位渲染同一场景的多角度参考图，拼接为一张带序号的宫格图，对应 LibTV 的 9/25 宫格分镜。
function exportContactSheet(grid: 9 | 25, aspect: number) {
  if (anchors.value.length < grid) return void ElMessage.warning(`宫格截图需要至少 ${grid} 个机位，当前 ${anchors.value.length} 个`);
  return exportToCanvas("image", `contact-${grid}`, aspect, async signal => {
    const [resolved, settings] = await Promise.all([resolveScene(scene.value), resolveSettings(sceneSettings.value)]);
    const columns = grid === 9 ? 3 : 5;
    const cellWidth = Math.round(640 * Math.min(1, aspect));
    const cellHeight = Math.round(640 / Math.max(1, aspect));
    const canvas = document.createElement("canvas");
    canvas.width = columns * cellWidth;
    canvas.height = columns * cellHeight;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#141418";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < grid; index += 1) {
      const anchor = anchors.value[index]!;
      const file = await renderImage(resolved, anchor, aspect, anchor.time ?? 0, signal, selectedPlan.value, lighting.value, settings);
      const bitmap = await createImageBitmap(file);
      const x = (index % columns) * cellWidth;
      const y = Math.floor(index / columns) * cellHeight;
      context.drawImage(bitmap, x, y, cellWidth, cellHeight);
      bitmap.close();
      context.fillStyle = "rgba(0, 0, 0, 0.55)";
      context.fillRect(x, y + cellHeight - 30, 64, 30);
      context.fillStyle = "#ffffff";
      context.font = "600 18px system-ui, sans-serif";
      context.fillText(String(index + 1).padStart(2, "0"), x + 10, y + cellHeight - 9);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("宫格参考图合成失败")), "image/png"));
    return new File([blob], `宫格参考图-${grid}宫格.png`, { type: "image/png" });
  });
}

async function loadModels() {
  if (modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    const available = await ai.getModels();
    if (disposed) return;
    models.value = available;
    const first = groupNodeModels(models.value)[0]?.models[0];
    // ACT: 只给空配置选默认模型，保留暂时不可用的旧选择。
    if (!model.value) model.value = first ? JSON.stringify([first.providerId, first.modelId]) : "";
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "模型加载失败");
  } finally {
    modelsLoading.value = false;
  }
}

async function renderPreview(scene: SceneDocument, plan: DirectorPlan | undefined, lighting: LightingSettings, settings: SceneSettings) {
  const [resolved, resolvedSettings] = await Promise.all([resolveScene(scene), resolveSettings(settings)]);
  const runtime = await createStage(document.createElement("canvas"), resolved, undefined, undefined, lighting, resolvedSettings);
  let player: ReturnType<typeof prepareSceneAnimation> | undefined;
  try {
    if (plan) {
      player = prepareSceneAnimation(runtime, plan);
      player.setTime(plan.duration);
      sampleMotion(runtime.camera, prepareMotion(plan.cameraFrames), plan.duration);
    }
    return capturePreview(runtime);
  } finally {
    player?.dispose();
    disposeStage(runtime);
  }
}

const planPreviews = new WeakMap<DirectorPlan, { scene: SceneDocument; lighting: LightingSettings; settings: SceneSettings; image: string }>();
watch([scene, selectedPlan, lighting, sceneSettings, modelLoading, previewReady, backdropUrl], async ([value, plan, light, settings, loading, ready]) => {
  const version = ++previewVersion;
  preview.value = "";
  if (!ready || loading || modelError.value) return;
  // 空场景保留引导插画，有了物体或方案才渲染镜头预览。
  if (!plan && !value.objectList.length) return;
  try {
    const cached = plan && planPreviews.get(plan);
    const image = cached?.scene === value && JSON.stringify(cached.lighting) === JSON.stringify(light) && JSON.stringify(cached.settings) === JSON.stringify(settings) ? cached.image : await renderPreview(value, plan, light, settings);
    if (plan) planPreviews.set(plan, { scene: value, lighting: light, settings, image });
    if (!disposed && version === previewVersion) preview.value = image;
  } catch (error) {
    if (!disposed && version === previewVersion) ElMessage.error(error instanceof Error ? error.message : "预览生成失败");
  }
}, { immediate: true });

async function saveScene() {
  await modelReady;
  let pending: Promise<void>;
  do {
    pending = modelSaving;
    await pending;
  } while (pending !== modelSaving);
  if (!disposed) ElMessage.success("场景已保存");
}

// ACT: 场景识别 —— 把参考图交给现有 agent 链路，按可见结构重建白模；识别结果与原图、连线都保留。
const recognizeInstruction = "识别附带的场景参考图：先分析可见物体、前后关系、开口与地面，以合理米制尺寸搭建可编辑白模，优先使用内置 prop 组件（墙、门、窗、桌椅等）；保留原参考素材，图中看不见的结构明确说明推测。";

async function recognizeScene() {
  if (modelLoading.value || modelError.value) return;
  if (!referenceImage.value) return void ElMessage.warning("请先把图片节点连接到导演台输入");
  setPrompt(recognizeInstruction);
  await generate();
}

function setPrompt(value: string) {
  prompt.value = value;
  promptModel.value = value ? value.split("\n").map(text => [{ type: "Write", text }]) : [];
}

async function generate() {
  if (modelLoading.value || modelError.value || addingMannequin.value) return;
  if (agentRunning.value) return void ElMessage.info("正在生成，请先等待或停止当前任务");
  if (pendingApply.value) return void ElMessage.warning("请先应用或放弃待确认的草稿");
  // 卡片直接发送时模型列表可能尚未加载，先补齐默认模型再判断。
  if (!models.value.length) await loadModels();
  if (disposed || modelLoading.value || modelError.value) return;
  const requirement = prompt.value.trim();
  if (!requirement) return;
  const choice = selectedModel.value;
  if (!choice) return void ElMessage.warning("请先在导演台 Agent 里选择文本模型");
  const baseScene = scene.value;
  const basePlanId = data.value.selectedPlanId ?? "";
  const task = { id: crypto.randomUUID(), instruction: requirement };
  const assistantId = crypto.randomUUID();
  const controller = new AbortController();
  chatController = controller;
  agentRunning.value = true;
  agentStatus.value = "正在读取场景…";
  tasks.value = [...tasks.value, task];
  pushMessage({ id: crypto.randomUUID(), role: "user", text: requirement, time: Date.now(), instruction: requirement });
  pushMessage({ id: assistantId, role: "assistant", text: "", time: Date.now(), status: "running", instruction: requirement });
  persistMessages();
  setPrompt("");
  let streamed = "";
  try {
    const workspaceFiles = files.getWorkspaceFiles();
    if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
    const mediaReferences = refList.value
      .filter(item => item.value !== undefined && (item.dataType === "STRING" || item.dataType === "IMAGE" || item.dataType === "VIDEO"))
      .map(item => item.dataType === "STRING" ? { dataType: item.dataType, value: item.value } : { dataType: item.dataType, value: { ...item.value } });
    const references = anchors.value.map((value, index) => {
      const { camera, controls } = anchorSchema.parse(value);
      return { order: index + 1, camera, controls };
    });
    const basePlan = selectedPlan.value;
    const draft = createDirectorDraft(
      JSON.parse(JSON.stringify(baseScene)),
      basePlan ? directorPlanSchema.parse({ name: basePlan.name, duration: basePlan.duration, tracks: basePlan.tracks, cameraFrames: basePlan.cameraFrames }) : undefined,
      JSON.parse(JSON.stringify(plans.value)),
    );
    const directory = mediaReferences.some(item => item.dataType !== "STRING") ? (await workspaceFiles.list()).directory : undefined;
    if (disposed) return;
    const result = await ai.generate({
      references: mediaReferences,
      providerId: choice.providerId,
      modelId: choice.modelId,
      systemPrompt: directorPrompt,
      prompt: JSON.stringify({ instruction: requirement, references, selectedPlanId: basePlanId, document: draft.summary() }),
      directory,
      tools: draft.tools,
      signal: controller.signal,
      onEvent(event) {
        if (controller.signal.aborted) return;
        if (event.type === "text") {
          streamed += event.delta;
          updateMessage(assistantId, { text: streamed.slice(0, 4000) });
          agentStatus.value = "正在整理结果…";
        } else if (event.type === "toolStart") {
          agentStatus.value = event.name === "readDocument" ? "正在读取场景…" : event.name === "editDocument" ? "正在修改场景…" : "正在处理…";
        } else if (event.type === "toolEnd") {
          agentStatus.value = event.isError ? "工具返回错误，正在修正…" : "正在继续修改…";
        }
      },
    });
    if (disposed) return;
    if (!draft.edited) throw new Error("Agent 未修改方案，原方案未修改，请重试。");
    const parsed = draft.read();
    const nextScene = draft.sceneChanged ? parsed.scene : baseScene;
    // ACT: 没有基准方案且 agent 只改了场景时，不再生成空方案，避免方案列表堆垃圾。
    const plan = basePlan || draft.planChanged ? { ...parsed.plan, id: task.id, instruction: requirement } : undefined;
    // 工具仅编辑草稿；完成后验证实际渲染，成功落盘才替换当前方案。
    const previewLighting = { ...getSceneLighting(nextScene), ...data.value.lighting };
    const previewSettings = sceneSettings.value;
    agentStatus.value = "正在渲染预览…";
    const image = await renderPreview(nextScene, plan, previewLighting, previewSettings);
    if (disposed) return;
    const summary = plan
      ? `${nextScene.objectList.length} 个物体 · ${plan.tracks.length} 条动画轨道 · ${plan.cameraFrames.length} 个镜头关键帧 · ${plan.duration.toFixed(1)} 秒`
      : `${nextScene.objectList.length} 个物体 · 本次仅调整场景`;
    const pending: PendingApply = {
      id: crypto.randomUUID(), messageId: assistantId, instruction: requirement,
      scene: nextScene, plan, sceneChanged: draft.sceneChanged,
      baseScene, basePlanId, previewImage: image, previewLighting, previewSettings, summary,
    };
    const text = (result.text ?? "").trim() || "已完成本轮修改。";
    tasks.value = tasks.value.filter(item => item.id !== task.id);
    if (confirmApply.value) {
      pendingApply.value = pending;
      updateMessage(assistantId, { text, status: "pending" });
      persistMessages();
      ElMessage.success("草稿已生成，确认后再写入场景");
    } else {
      await writeDraft(pending);
      updateMessage(assistantId, { text, status: "done" });
      persistMessages();
      ElMessage.success("已更新场景与方案");
    }
  } catch (error) {
    const aborted = controller.signal.aborted;
    const message = aborted ? "已停止生成，场景未修改。" : error instanceof Error ? error.message : "生成失败，请重试";
    updateMessage(assistantId, aborted
      ? { text: streamed.trim(), status: "stopped" }
      : { text: streamed.trim(), status: "error", error: message });
    if (!aborted && !disposed) ElMessage.error(message);
    tasks.value = tasks.value.filter(item => item.id !== task.id);
    persistMessages();
  } finally {
    if (chatController === controller) chatController = undefined;
    agentRunning.value = false;
    agentStatus.value = "";
  }
}

// ACT: 统一的落盘路径 —— 自动应用与手动确认共用，保证场景基线校验、轨道清理和撤销栈处理只写一份。
async function writeDraft(pending: PendingApply) {
  const workspaceFiles = files.getWorkspaceFiles();
  const saving = modelSaving.then(async () => {
    if (disposed) return;
    if (scene.value !== pending.baseScene) throw new Error("基础模型已被另一条指令更新，请基于当前模型重试。");
    const objects = new Map(pending.scene.objectList.map(object => [object.threeJsonId, object]));
    const previousPlans = pending.sceneChanged
      ? plans.value.map(item => ({ ...item, tracks: item.tracks.filter(track => objects.has(track.objectId) && (!track.joint || objects.get(track.objectId)?.objType === "mannequin")) }))
      : plans.value;
    const value: ModelDocument = { version: 1, scene: pending.scene, plans: pending.plan ? [...previousPlans, pending.plan] : previousPlans };
    const path = await writeModel(workspaceFiles, value);
    if (disposed) return;
    if (pending.plan) planPreviews.set(pending.plan, { scene: pending.scene, lighting: pending.previewLighting, settings: pending.previewSettings, image: pending.previewImage ?? "" });
    modelDocument.value = value;
    data.value.modelPath = path;
    if (pending.plan && (data.value.selectedPlanId ?? "") === pending.basePlanId) data.value.selectedPlanId = pending.plan.id;
    // AI 结果作为新的编辑基线，之前的撤销记录不再适用。
    undoStack.length = 0;
    redoStack.length = 0;
    undoDepth.value = 0;
    redoDepth.value = 0;
  });
  modelSaving = saving.catch(() => {});
  await saving;
}

async function applyPending() {
  const pending = pendingApply.value;
  if (!pending || applying.value) return;
  applying.value = true;
  try {
    await writeDraft(pending);
    pendingApply.value = null;
    updateMessage(pending.messageId, { status: "done" });
    persistMessages();
    ElMessage.success("已应用到场景");
  } catch (error) {
    const message = error instanceof Error ? error.message : "应用失败，请重试";
    updateMessage(pending.messageId, { status: "error", error: message });
    persistMessages();
    ElMessage.error(message);
  } finally {
    applying.value = false;
  }
}

function discardPending() {
  const pending = pendingApply.value;
  if (!pending) return;
  pendingApply.value = null;
  const current = agentMessages.value.find(message => message.id === pending.messageId);
  updateMessage(pending.messageId, { text: `${current?.text?.trim() ? `${current.text.trim()}\n` : ""}（已放弃本次修改）`, status: "done" });
  persistMessages();
  ElMessage.info("已放弃本次修改");
}

function stopGenerate() {
  chatController?.abort();
}

async function clearMessages() {
  if (!agentMessages.value.length) return;
  try {
    await ElMessageBox.confirm("清空对话记录？场景与方案不会受影响。", "清空对话", {
      type: "warning", confirmButtonText: "清空", cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  agentMessages.value = [];
  persistMessages();
  ElMessage.success("对话已清空");
}

function retryInstruction(instruction: string) {
  setPrompt(instruction);
  void generate();
}

function suggestInstruction(text: string) {
  setPrompt(text);
  void generate();
}

async function submitPrompt() {
  if (!prompt.value.trim() || generating.value || modelLoading.value) return;
  await openEditor();
  if (disposed || !editing.value) return;
  aiOpen.value = true;
  if (!models.value.length) await loadModels();
  await generate();
}

async function addReference() {
  if (!selectAssetReference) return void ElMessage.info("请在画布连接参考节点，或在输入框中输入 @ 引用");
  try {
    await selectAssetReference();
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "素材引用失败");
  }
}

// ---------- 手动关键帧 ----------
// ACT: 把物体当前的位移 / 旋转 / 缩放（人偶连同各关节姿势）记录到选中方案的时间点上，与 AI 生成的轨道共用同一套数据。
function upsertTrack(tracks: PlanTrack[], objectId: string, joint: string | undefined, frame: PlanFrame): PlanTrack[] {
  const index = tracks.findIndex(track => track.objectId === objectId && track.joint === joint);
  if (index < 0) return [...tracks, { objectId, ...(joint ? { joint: joint as NonNullable<PlanTrack["joint"]> } : {}), frames: frame.time > 0 ? [{ ...frame, time: 0 }, frame] : [{ ...frame, time: 0 }] }];
  const previous = tracks[index]!;
  const frames = [...previous.frames.filter(item => item.time !== frame.time), frame].sort((a, b) => a.time - b.time);
  return tracks.map((item, position) => position === index ? { ...item, frames: frames[0]!.time === 0 ? frames : [{ ...frames[0]!, time: 0 }, ...frames] } : item);
}

async function addKeyframe(objectId: string, time: number) {
  try {
    await updateModelDocument(document => {
      const object = document.scene.objectList.find(item => item.threeJsonId === objectId);
      if (!object) throw new Error("物体不存在，无法添加关键帧");
      const stamp = Math.max(0, Math.min(300, Math.round(time * 100) / 100));
      const plan = document.plans.find(item => item.id === data.value.selectedPlanId) ?? document.plans[0];
      let tracks: PlanTrack[] = plan?.tracks ?? [];
      tracks = upsertTrack(tracks, objectId, undefined, {
        time: stamp,
        position: { ...object.position },
        rotation: { x: object.rotation?.rotationX ?? 0, y: object.rotation?.rotationY ?? 0, z: object.rotation?.rotationZ ?? 0 },
        scale: { x: object.scale?.scaleX ?? 1, y: object.scale?.scaleY ?? 1, z: object.scale?.scaleZ ?? 1 },
      });
      // 人偶同时记录关节姿势：已有姿势或已有关节轨道的关节都写入，未设置的关节记为零旋转（回到自然站姿）。
      if (object.objType === "mannequin") {
        for (const joint of mannequinJoints) {
          const rotation = object.pose?.[joint];
          if (rotation || tracks.some(track => track.objectId === objectId && track.joint === joint)) {
            tracks = upsertTrack(tracks, objectId, joint, { time: stamp, rotation: rotation ?? { x: 0, y: 0, z: 0 } });
          }
        }
      }
      if (tracks.some(track => track.frames.length > 120)) throw new Error("单条轨道最多 120 个关键帧");
      const duration = Math.max(plan?.duration ?? 5, stamp);
      const nextPlan = plan ? { ...plan, duration, tracks } : {
        id: crypto.randomUUID(), name: "方案 1", duration: Math.max(5, stamp), tracks,
        cameraFrames: [{ time: 0, view: { camera: document.scene.sceneConfig.camera, controls: document.scene.sceneConfig.controls }, easing: "smooth" as const }],
      };
      const value = { ...nextPlan, ...directorPlanSchema.parse({ name: nextPlan.name, duration: nextPlan.duration, tracks: nextPlan.tracks, cameraFrames: nextPlan.cameraFrames }) };
      const plans = plan ? document.plans.map(item => item.id === plan.id ? value : item) : [...document.plans, value];
      data.value.selectedPlanId = value.id;
      return { ...document, plans };
    }, "关键帧添加失败");
    ElMessage.success("已在当前时间记录关键帧");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "关键帧添加失败");
  }
}

async function removeTrack(objectId: string, joint?: string) {
  try {
    await updateModelDocument(document => ({
      ...document,
      plans: document.plans.map(plan => ({ ...plan, tracks: plan.tracks.filter(track => track.objectId !== objectId || track.joint !== joint) })),
    }), "动画轨迹删除失败");
    ElMessage.success("动画轨迹已删除");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "动画轨迹删除失败");
  }
}

// ---------- 手动镜头关键帧 ----------
type CameraKeyframeInput = { camera: CameraAnchor["camera"]; controls: CameraAnchor["controls"] };

// ACT: 镜头关键帧与物体轨道共用方案；记录时保证 0 秒基准帧存在、时间严格递增，并自动延长方案时长。
async function addCameraKeyframe(view: CameraKeyframeInput, time: number) {
  try {
    await updateModelDocument(document => {
      const stamp = Math.max(0, Math.min(300, Math.round(time * 100) / 100));
      const plan = document.plans.find(item => item.id === data.value.selectedPlanId) ?? document.plans[0];
      let frames: Plan["cameraFrames"] = plan ? [...plan.cameraFrames] : [];
      if (!frames.length) {
        frames = [{ time: 0, view: { camera: document.scene.sceneConfig.camera, controls: document.scene.sceneConfig.controls }, easing: "smooth" as const }];
      }
      frames = frames.filter(frame => Math.abs(frame.time - stamp) > 0.001);
      frames.push({ time: stamp, view, easing: "smooth" as const });
      frames.sort((a, b) => a.time - b.time);
      if (frames[0]!.time !== 0) frames.unshift({ ...frames[0]!, time: 0 });
      if (frames.length > 120) throw new Error("单个方案最多 120 个镜头关键帧");
      const duration = Math.max(plan?.duration ?? 5, stamp, frames.at(-1)!.time, 0.2);
      const tracks = plan?.tracks ?? [];
      const nextPlan = plan
        ? { ...plan, duration, cameraFrames: frames }
        : { id: crypto.randomUUID(), name: "方案 1", duration, tracks, cameraFrames: frames };
      const value = { ...nextPlan, ...directorPlanSchema.parse({ name: nextPlan.name, duration: nextPlan.duration, tracks: nextPlan.tracks, cameraFrames: nextPlan.cameraFrames }) };
      data.value.selectedPlanId = value.id;
      return { ...document, plans: plan ? document.plans.map(item => item.id === plan.id ? value : item) : [...document.plans, value] };
    }, "镜头关键帧记录失败");
    ElMessage.success("已记录镜头关键帧");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "镜头关键帧记录失败");
  }
}

async function removeCameraKeyframe(time: number) {
  try {
    await updateModelDocument(document => {
      const plan = document.plans.find(item => item.id === data.value.selectedPlanId) ?? document.plans[0];
      if (!plan) throw new Error("当前没有可编辑的方案");
      const stamp = Math.round(time * 100) / 100;
      const frames = plan.cameraFrames.filter(frame => Math.abs(frame.time - stamp) > 0.02);
      if (frames.length === plan.cameraFrames.length) throw new Error("当前时间没有镜头关键帧");
      if (!frames.length) throw new Error("至少保留一个镜头关键帧");
      if (frames[0]!.time !== 0) frames[0] = { ...frames[0]!, time: 0 };
      const value = { ...plan, ...directorPlanSchema.parse({ name: plan.name, duration: plan.duration, tracks: plan.tracks, cameraFrames: frames }) };
      return { ...document, plans: document.plans.map(item => item.id === plan.id ? value : item) };
    }, "镜头关键帧删除失败");
    ElMessage.success("已删除当前镜头关键帧");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "镜头关键帧删除失败");
  }
}

async function removeObjectKeyframe(objectId: string, time: number) {
  try {
    await updateModelDocument(document => {
      const stamp = Math.round(time * 100) / 100;
      const targetPlanId = data.value.selectedPlanId ?? document.plans[0]?.id;
      let removed = 0;
      const plans = document.plans.map(plan => {
        if (plan.id !== targetPlanId) return plan;
        const tracks = plan.tracks.flatMap(track => {
          if (track.objectId !== objectId) return [track];
          const frames = track.frames.filter(frame => Math.abs(frame.time - stamp) > 0.02);
          if (frames.length === track.frames.length) return [track];
          removed += track.frames.length - frames.length;
          // 轨道至少要两帧才有插值意义；只剩一帧时整条轨道一并移除。
          if (frames.length < 2) return [];
          if (frames[0]!.time !== 0) frames[0] = { ...frames[0]!, time: 0 };
          return [{ ...track, frames }];
        });
        return { ...plan, tracks: directorPlanSchema.shape.tracks.parse(tracks) };
      });
      if (!removed) throw new Error("当前时间没有该物体的关键帧");
      return { ...document, plans };
    }, "关键帧删除失败");
    ElMessage.success("已删除当前时间的关键帧");
  } catch (error) {
    if (!disposed) ElMessage.error(error instanceof Error ? error.message : "关键帧删除失败");
  }
}
</script>

<style scoped lang="scss">
.directorContent {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
  color: var(--el-text-color-regular);

  .sceneCard {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    cursor: pointer;
    border: 1px solid var(--el-border-color);
    border-radius: 12px;
    background: var(--el-bg-color);
    transition: border-color 0.2s, box-shadow 0.2s;
    &:hover, &:focus-visible { border-color: var(--el-color-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 14%, transparent); outline: none; }
    .scenePreview { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  }
  .sceneEmpty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px;
    text-align: center;
    color: var(--el-text-color-secondary);
    p { margin: 0; font-size: 12px; line-height: 1.5; }
    &.overlay {
      background: linear-gradient(180deg, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 0.72));
      color: #fff;
      justify-content: flex-end;
      :deep(svg) { display: none; }
    }
  }
  .openButton {
    padding: 5px 14px;
    border: 0;
    border-radius: 999px;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    &:hover { background: var(--el-color-primary-light-3); }
    &:disabled { opacity: 0.6; cursor: wait; }
  }
  .promptCard {
    padding: 8px 10px 8px;
    border: 1px solid var(--el-border-color);
    border-radius: 12px;
    background: var(--el-bg-color);
    :deep(.promptInputWrap) { margin: 0; }
    :deep(.chat-rich-text > [contenteditable]) { min-height: 44px; }
    .promptFooter {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 4px;
      .footerButton, .sendButton {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 50%;
        cursor: pointer;
        color: var(--el-text-color-regular);
        background: var(--el-fill-color);
        &:hover { background: var(--el-fill-color-dark); }
        &:disabled { opacity: 0.5; cursor: not-allowed; }
      }
      .sendButton { background: var(--el-color-primary); color: #fff; }
      .generatingHint { flex: 1; font-size: 11px; color: var(--el-color-primary); }
    }
  }
}
</style>
