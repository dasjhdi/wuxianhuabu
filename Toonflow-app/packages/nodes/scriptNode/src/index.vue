<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :bottomWidth="680"
    :style="{ width: '340px' }">
    <template #top>
      <el-card class="mediaToolbar" shadow="never" :bodyStyle="{ padding: '6px', display: 'flex', alignItems: 'center' }">
        <span class="assetCount"><icon-photo :size="15" /> 已连接资产 {{ assetSources.length }}</span>
        <span class="assetCount"><icon-file-text :size="15" /> 镜头 {{ shots.length }}</span>
      </el-card>
    </template>
    <div class="scriptSummary nodrag nopan nowheel" @pointerdown.stop @dblclick.stop>
      <template v-if="shots.length">
        <div v-for="(shot, index) in shots" :key="shot.id" class="shotRow">
          <span class="shotIndex">{{ String(index + 1).padStart(2, "0") }}</span>
          <span class="shotBrief">{{ shot.description.slice(0, 42) }}{{ shot.description.length > 42 ? "…" : "" }}</span>
          <span class="shotSize">{{ shot.shotSize }} · {{ shot.duration }}s</span>
        </div>
        <p class="summaryHint">在下方面板编辑分镜，然后批量创建生成器组</p>
      </template>
      <p v-else class="summaryHint">粘贴剧本或输入灵感 → 拆解分镜 → 批量创建生成器组</p>
    </div>
    <template #bottom>
      <el-card class="scriptCard nodrag nopan nowheel" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }" @pointerdown.stop @dblclick.stop>
        <div class="scriptHeader">
          <el-input v-model="oneLiner" class="oneLinerInput" size="small" placeholder="一句话灵感：例如 深夜面馆里，老板与老友重逢" :disabled="busy" aria-label="创作灵感" @keydown.stop />
          <el-button size="small" :icon="IconSparkles" :loading="writingScript" :disabled="busy || !oneLiner.trim() || !selectedModel" @click="generateScript">生成剧本</el-button>
        </div>
        <el-input v-model="script" type="textarea" :rows="6" maxlength="12000" placeholder="粘贴完整剧本，或点击上方「生成剧本」由 AI 撰写。也可从文本节点连线接入剧本。" aria-label="剧本内容" @keydown.stop />
        <div class="breakdownRow">
          <el-select :modelValue="selectedModel ? aiModel : ''" class="modelSelect" size="small" :loading="modelsLoading" filterable placeholder="选择拆解模型" aria-label="拆解模型" noDataText="请先在设置中添加文本模型" @update:modelValue="aiModel = $event" @visible-change="visible => visible && loadModels()">
            <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModel?.providerId" :modelId="selectedModel?.modelId" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="item in provider.models" :key="item.modelId" :value="JSON.stringify([item.providerId, item.modelId])" :label="item.label">
                <modelLabel :label="item.label" :providerId="item.providerId" :modelId="item.modelId" />
              </el-option>
            </el-option-group>
          </el-select>
          <el-button type="primary" size="small" :icon="IconScissors" :loading="breaking" :disabled="busy || !script.trim() || !selectedModel" @click="breakdown">{{ shots.length ? "重新拆解" : "拆解分镜" }}</el-button>
        </div>
        <div v-if="shots.length" class="shotEditor">
          <div class="editorHeader"><span>分镜清单 <small>{{ shots.length }} 个镜头</small></span><small>在画布生成器组中可继续精修</small></div>
          <div v-for="(shot, index) in shots" :key="shot.id" class="shotCard">
            <div class="shotHead">
              <span class="shotIndex">{{ String(index + 1).padStart(2, "0") }}</span>
              <el-input v-model="shot.scene" size="small" class="sceneInput" placeholder="场景" @keydown.stop />
              <el-select v-model="shot.shotSize" size="small" class="sizeSelect" aria-label="景别">
                <el-option v-for="size in ['远景', '全景', '中景', '近景', '特写']" :key="size" :value="size" :label="size" />
              </el-select>
              <el-input-number v-model="shot.duration" size="small" :min="3" :max="10" :step="1" controlsPosition="right" class="durationInput" aria-label="建议时长(秒)" />
              <span class="shotActions">
                <el-button text size="small" :icon="IconArrowUp" :disabled="index === 0" aria-label="上移" @click="moveShot(index, -1)" />
                <el-button text size="small" :icon="IconArrowDown" :disabled="index === shots.length - 1" aria-label="下移" @click="moveShot(index, 1)" />
                <el-button text size="small" :icon="IconTrash" aria-label="删除镜头" @click="shots.splice(index, 1)" />
              </span>
            </div>
            <el-input v-model="shot.description" type="textarea" :rows="2" maxlength="300" placeholder="画面描述（构图、主体、视觉细节）" aria-label="画面描述" @keydown.stop />
            <div class="shotMeta">
              <el-input v-model="shot.characters" size="small" placeholder="出场角色，逗号分隔" @keydown.stop />
              <el-input v-model="shot.dialogue" size="small" placeholder="对白 / 旁白" @keydown.stop />
            </div>
            <div class="shotMeta">
              <el-input v-model="shot.action" size="small" placeholder="角色动作" @keydown.stop />
            </div>
          </div>
          <el-button text size="small" :icon="IconPlus" @click="addShot">添加镜头</el-button>
        </div>
        <p v-if="errorMessage" class="errorMessage" role="alert">{{ errorMessage }}</p>
        <div class="promptFooter">
          <el-button :icon="IconPhoto" size="small" :disabled="busy || !shots.length || !imageModels.length" @click="batchDialog = 'image'">批量生成分镜图</el-button>
          <el-button :icon="IconMovie" size="small" :disabled="busy || !shots.length || !videoModels.length" @click="batchDialog = 'video'">批量生成镜头视频</el-button>
        </div>
        <div v-if="createdGenerators.length" class="batchRunRow nodrag nopan nowheel">
          <el-button type="primary" size="small" :icon="IconPlayerPlay" :loading="batchRunning" :disabled="batchRunning || !createdGenerators.length" @click="runBatch">批量执行生成器组（{{ createdGenerators.length }} 个）</el-button>
          <span v-if="batchSummary" class="batchSummary" role="status">{{ batchSummary }}</span>
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
  <el-dialog :modelValue="batchDialog !== ''" :title="batchDialog === 'image' ? '批量生成分镜图' : '批量生成镜头视频'" width="min(560px, calc(100vw - 32px))" alignCenter appendToBody :closeOnClickModal="false" @update:modelValue="value => value || (batchDialog = '')">
    <div class="batchDialog nodrag nopan nowheel" @pointerdown.stop @dblclick.stop @keydown.stop>
      <p class="batchHint">将创建 {{ shots.length }} 个{{ batchDialog === "image" ? "图片" : "视频" }}生成器组，自动带入分镜提示词并连线已连接的资产。创建后可在各生成器中精修，再逐个执行生成。</p>
      <el-select :modelValue="mediaModel" class="batchModelSelect" filterable placeholder="选择模型" aria-label="生成模型" @update:modelValue="mediaModel = $event">
        <template #label="{ label }"><modelLabel :label="label" :providerId="selectedMediaModel?.providerId" :modelId="selectedMediaModel?.modelId" /></template>
        <el-option-group v-for="provider in mediaGroups" :key="provider.id" :label="provider.label">
          <el-option v-for="item in provider.models" :key="item.modelId" :value="JSON.stringify([item.providerId, item.modelId])" :label="item.label">
            <modelLabel :label="item.label" :providerId="item.providerId" :modelId="item.modelId" />
          </el-option>
        </el-option-group>
      </el-select>
      <el-select v-model="batchRatio" class="batchRatioSelect" aria-label="画幅比例">
        <el-option v-for="ratio in ['16:9', '9:16', '4:3', '1:1']" :key="ratio" :value="ratio" :label="ratio" />
      </el-select>
    </div>
    <template #footer>
      <el-button @click="batchDialog = ''">取消</el-button>
      <el-button type="primary" :disabled="!mediaModel || creating" :loading="creating" @click="createGenerators">确认并创建生成器组</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { IconPhoto, IconFileText, IconSparkles, IconScissors, IconArrowUp, IconArrowDown, IconTrash, IconPlus, IconMovie, IconPlayerPlay } from "@tabler/icons-vue";
import { ElButton, ElCard, ElDialog, ElInput, ElInputNumber, ElMessage, ElOption, ElOptionGroup, ElSelect } from "element-plus";
import { nodeSkeleton, useNode, useNodeInputs, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import modelLabel from "@toonflow/node-shared/modelLabel";
import { useVueFlow } from "@vue-flow/core";
import type { Node } from "@vue-flow/core";
import { BREAKDOWN_SYSTEM, SCRIPT_SYSTEM, breakdownPrompt, parseStoryboard, scriptPrompt, shotPrompt, type ScriptNodeState, type StoryboardShot } from "./storyboard";

defineOptions({
  inheritAttrs: false,
  icon: IconFileText,
  handles: [
    { id: "in", type: "target", dataType: ["STRING", "IMAGE"], label: "剧本文本、角色与场景图" },
  ] satisfies NodeHandle[],
});

const { id, node, nodeProps, ai } = useNode({ label: "脚本" });
const nodeData = node.data as typeof node.data & { scriptNode?: ScriptNodeState };
const saved = nodeData.scriptNode;
const script = ref(saved?.script ?? "");
const oneLiner = ref(saved?.oneLiner ?? "");
const aiModel = ref(saved?.aiModel ?? "");
const shots = reactive<StoryboardShot[]>(Array.isArray(saved?.shots) ? saved!.shots.map(shot => ({ ...shot })) : []);
const writingScript = ref(false);
const breaking = ref(false);
const creating = ref(false);
const errorMessage = ref("");
const batchDialog = ref<"" | "image" | "video">("");
const batchRatio = ref("16:9");
const mediaModel = ref("");

const inputs = useNodeInputs();
const incoming = computed(() => inputs.getTargetValues(id, "in"));
const { getEdges, getNodes, addNodes, nodeTypes } = useVueFlow();

function persist() {
  nodeData.scriptNode = { script: script.value, oneLiner: oneLiner.value, aiModel: aiModel.value, shots: JSON.parse(JSON.stringify(shots)) };
}
watch([script, oneLiner, aiModel, shots], persist, { deep: true, flush: "sync", immediate: true });
onScopeDispose(() => window.removeEventListener("toonflow:batch-progress", onBatchProgress));

// ACT: 连接的图片节点是角色/场景资产，创建生成器组时把它们的连线复制到每个生成器。
const assetSources = computed(() => {
  const edges = getEdges.value.filter(edge => edge.target === id);
  return edges.flatMap(edge => {
    const sourceNode = getNodes.value.find(candidate => candidate.id === edge.source);
    const output = (sourceNode?.data as { outputs?: Record<string, { dataType?: string }> } | undefined)?.outputs;
    if (!output || !Object.values(output).some(item => item?.dataType === "IMAGE")) return [];
    return [edge.source];
  });
});

const textModels = ref<Array<{ providerId: string; modelId: string; label: string }>>([]);
const modelsLoading = ref(false);
const selectedModel = computed(() => textModels.value.find(item => JSON.stringify([item.providerId, item.modelId]) === aiModel.value));
const modelGroups = computed(() => groupNodeModels(textModels.value as never));

async function loadModels() {
  if (modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    const available = await ai.getModels();
    textModels.value = available;
    if (!aiModel.value) aiModel.value = available[0] ? JSON.stringify([available[0].providerId, available[0].modelId]) : "";
  } finally {
    modelsLoading.value = false;
  }
}
void loadModels();

// 媒体模型列表（图片 / 视频分组，供批量生成器组选择）
type MediaModel = { providerId: string; modelId: string; label: string; type: string; durationResolutionMap?: { duration: number[]; resolution: string[] }[] };
const mediaModels = ref<MediaModel[]>([]);
const mediaLoading = ref(false);
const imageModels = computed(() => mediaModels.value.filter(item => item.type === "image"));
const videoModels = computed(() => mediaModels.value.filter(item => item.type === "video"));
const selectedMediaModel = computed(() => mediaModels.value.find(item => JSON.stringify([item.providerId, item.modelId]) === mediaModel.value));
const mediaGroups = computed(() => groupNodeModels(mediaModels.value as never));
watch(batchDialog, async value => {
  if (!value || mediaModels.value.length || mediaLoading.value) return;
  mediaLoading.value = true;
  try {
    const response = await fetch("/api/ai/media/models");
    mediaModels.value = (await response.json())?.data ?? [];
  } finally {
    mediaLoading.value = false;
  }
});

function readError(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return message || (error instanceof Error ? error.message : fallback);
}

// ACT: AI 请求必须带超时与取消 —— 否则模型无响应时按钮永久卡在加载态。
async function generateScript() {
  if (writingScript.value || !oneLiner.value.trim() || !selectedModel.value) return;
  writingScript.value = true;
  errorMessage.value = "";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new Error("生成超时（180 秒无响应），请重试或更换模型")), 180_000);
  try {
    const model = selectedModel.value;
    const response = await ai.generate({
      providerId: model.providerId,
      modelId: model.modelId,
      systemPrompt: SCRIPT_SYSTEM,
      prompt: scriptPrompt(oneLiner.value.trim()),
      signal: controller.signal,
    });
    script.value = response.text.trim() || script.value;
    ElMessage.success("剧本已生成，可编辑后拆解分镜");
  } catch (error) {
    errorMessage.value = readError(error, "剧本生成失败");
  } finally {
    window.clearTimeout(timeout);
    writingScript.value = false;
  }
}

async function breakdown() {
  if (breaking.value || !script.value.trim() || !selectedModel.value) return;
  breaking.value = true;
  errorMessage.value = "";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new Error("拆解超时（180 秒无响应），请重试或更换模型")), 180_000);
  try {
    const model = selectedModel.value;
    const extra = incoming.value.filter(item => item.dataType === "STRING" && typeof item.value === "string" && item.value.trim()).map(item => item.value as string);
    const response = await ai.generate({
      providerId: model.providerId,
      modelId: model.modelId,
      systemPrompt: BREAKDOWN_SYSTEM,
      prompt: breakdownPrompt(script.value.trim() + (extra.length ? `\n\n补充设定：${extra.join("\n")}` : "")),
      signal: controller.signal,
    });
    const parsed = parseStoryboard(response.text);
    shots.splice(0, shots.length, ...parsed);
    ElMessage.success(`已拆解出 ${parsed.length} 个镜头，可编辑后批量创建生成器组`);
  } catch (error) {
    errorMessage.value = readError(error, "分镜拆解失败");
  } finally {
    window.clearTimeout(timeout);
    breaking.value = false;
  }
}

// ACT: 生成器组记录与批量执行 —— 对齐新影无限「批量生成，后台渲染」机制。
const createdGenerators = ref<Array<{ id: string; kind: "image" | "video"; name: string }>>([]);
const createdAssetIds = ref<string[]>([]);
const shotCharacters = computed(() => {
  const names = new Set<string>();
  for (const shot of shots) {
    for (const name of shot.characters.split(/[,，、]/).map(value => value.trim()).filter(Boolean)) names.add(name);
  }
  return names;
});
const batchRunning = ref(false);
const batchSummary = ref("");
const batchResults = ref<Record<string, { ok: boolean; error?: string }>>({});

function onBatchProgress(event: Event) {
  const detail = (event as CustomEvent<{ nodeId?: string; ok?: boolean; error?: string }>).detail;
  if (!detail?.nodeId) return;
  batchResults.value = { ...batchResults.value, [detail.nodeId]: { ok: !!detail.ok, error: detail.error } };
  const total = createdGenerators.value.length;
  const settled = createdGenerators.value.filter(item => batchResults.value[item.id]).length;
  const failed = createdGenerators.value.filter(item => batchResults.value[item.id] && !batchResults.value[item.id].ok).length;
  if (settled < total) batchSummary.value = `批量生成中：已完成 ${settled}/${total}（失败 ${failed}）`;
  else batchSummary.value = `批量生成完成：成功 ${total - failed}，失败 ${failed}（失败节点可单独重试）`;
}
window.addEventListener("toonflow:batch-progress", onBatchProgress);

async function runBatch() {
  if (batchRunning.value || !createdGenerators.value.length) return;
  batchResults.value = {};
  batchSummary.value = "已启动批量生成，后台渲染中…";
  window.dispatchEvent(new CustomEvent("toonflow:batch-generate", { detail: { nodeIds: createdGenerators.value.map(item => item.id) } }));
}

function addShot() {
  shots.push({ id: crypto.randomUUID(), description: "", action: "", shotSize: "中景", dialogue: "", characters: "", scene: "", duration: 5 });
}

function moveShot(index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= shots.length) return;
  shots.splice(to, 0, shots.splice(index, 1)[0]!);
}

function clampDuration(model: MediaModel, duration: number) {
  const allowed = (model.durationResolutionMap ?? []).flatMap(item => item.duration);
  if (!allowed.length) return Math.max(3, Math.min(10, Math.round(duration)));
  return allowed.reduce((best, value) => Math.abs(value - duration) < Math.abs(best - duration) ? value : best, allowed[0]!);
}

async function createGenerators() {
  if (creating.value || !mediaModel.value || !shots.length) return;
  const model = selectedMediaModel.value;
  if (!model) return;
  const required = batchDialog.value === "image" ? ["remote-imageNode", "canvasGroup"] : ["remote-videoNode", "remote-imageNode", "canvasGroup"];
  const missing = required.filter(type => !nodeTypes?.value?.[type]);
  if (missing.length) { ElMessage.error("请先启用所需的节点插件后再批量创建生成器组"); return; }
  creating.value = true;
  try {
    const isImage = batchDialog.value === "image";
    const type = isImage ? "remote-imageNode" : "remote-videoNode";
    const nodes: Node[] = [];
    const shotModels = shots.map(() => model);
    const width = isImage ? 340 : 360;
    const groupId = crypto.randomUUID();
    nodes.push({
      id: groupId,
      type: "canvasGroup",
      position: { x: 0, y: 0 },
      style: { width: `${2 * width + 48}px`, height: `${Math.ceil(shots.length / 2) * 420 + 96}px` },
      connectable: false,
      expandParent: false,
      data: { label: `${isImage ? "分镜图" : "镜头视频"}生成器组 · ${node.data.label || "脚本"}` },
    });
    shots.forEach((shot, index) => {
      const generatorId = crypto.randomUUID();
      nodes.push({
        id: generatorId,
        type,
        parentNode: groupId,
        expandParent: false,
        position: { x: 24 + index % 2 * (width + 16), y: 48 + Math.floor(index / 2) * 420 },
        data: isImage
          ? { prompt: shotPrompt(shot), promptModel: [], model: mediaModel.value, size: "", ratio: batchRatio.value, other: {} }
          : { prompt: shotPrompt(shot), promptModel: [], model: mediaModel.value, duration: clampDuration(model, shot.duration), resolution: "720p", ratio: batchRatio.value, mode: "", generateAudio: false, other: {} },
      });
    });
    addNodes(nodes);
    const generators = nodes.filter(item => item.type !== "canvasGroup");
    // ACT: 资产连线复制 —— 每个生成器都接上已连接的角色/场景图节点。
    if (assetSources.value.length) {
      for (const shot of shots) {
        const generator = generators.find(item => (item.data as { prompt?: string }).prompt === shotPrompt(shot));
        if (!generator) continue;
        for (const source of assetSources.value) {
          addEdges([{ id: crypto.randomUUID(), source, sourceHandle: "image", target: generator.id, targetHandle: "in" }]);
        }
      }
    }
    createdGenerators.value = generators.map(item => ({ id: item.id, kind: isImage ? "image" as const : "video" as const, name: (item.data as { label?: string }).label ?? "" }));
    // ACT: 对齐新影无限 —— 依据分镜中的角色与场景，自动创建缺失的资产生成节点并连线（角色/场景特征池）。
    if (!isImage && !imageModels.value.length) {
      ElMessage.warning("请先在图片生成节点使用过图像模型，或稍后重试（未检测到图像模型）");
    } else if (!isImage && assetSources.value.length < shots.length) {
      const names = new Set<string>();
      for (const shot of shots) {
        for (const name of shot.characters.split(/[,，、]/).map(value => value.trim()).filter(Boolean)) names.add(name);
        if (shot.scene.trim()) names.add(shot.scene.trim());
      }
      const connectedLabels = assetSources.value.map(source => (getNodes.value.find(candidate => candidate.id === source)?.data as { label?: string } | undefined)?.label ?? "");
      const missing = [...names].filter(name => name && !connectedLabels.some(label => label.includes(name)));
      if (missing.length) {
        const assetNodes: Node[] = [];
        const assetGroupId = crypto.randomUUID();
        const assetWidth = 320;
        assetNodes.push({
          id: assetGroupId,
          type: "canvasGroup",
          position: { x: 0, y: 0 },
          style: { width: `${assetWidth + 48}px`, height: `${Math.ceil(missing.length / 2) * 420 + 96}px` },
          connectable: false,
          expandParent: false,
          data: { label: `角色与场景资产 · ${node.data.label || "脚本"}` },
        });
        missing.forEach((name, index) => {
          const assetId = crypto.randomUUID();
          const isCharacter = shotCharacters.has(name);
          assetNodes.push({
            id: assetId,
            type: "remote-imageNode",
            parentNode: assetGroupId,
            expandParent: false,
            position: { x: 24 + index % 2 * (assetWidth + 16), y: 48 + Math.floor(index / 2) * 420 },
            data: {
              label: `${isCharacter ? "角色" : "场景"}：${name}`,
              prompt: isCharacter
                ? `角色设定图：${name}。全身立绘，服装与外貌清晰，纯色背景，影视级细节，统一角色形象`
                : `场景概念图：${name}。影视级场景概念设计，无人物，宽幅构图`,
              promptModel: [],
              model: JSON.stringify([imageModels.value[0].providerId, imageModels.value[0].modelId]),
              size: "",
              ratio: isCharacter ? "9:16" : "16:9",
              other: {},
            },
          });
          createdAssetIds.value.push(assetId);
        });
        addNodes(assetNodes);
        // 资产组摆放在脚本节点左侧；生成器组在右侧。
        const scriptX = node.computedPosition.x;
        const assetGroup = assetNodes[0];
        assetGroup.position = { x: Math.max(0, scriptX - (assetNodes[0].style?.width ? parseInt(String(assetNodes[0].style.width)) + 96 : 700)), y: node.computedPosition.y };
        for (const shot of shots) {
          const generator = generators.find(item => (item.data as { prompt?: string }).prompt === shotPrompt(shot));
          if (!generator) continue;
          for (const assetId of createdAssetIds.value) {
            addEdges([{ id: crypto.randomUUID(), source: assetId, sourceHandle: "image", target: generator.id, targetHandle: "in" }]);
          }
        }
      }
    }
    batchDialog.value = "";
    ElMessage.success(`已创建 ${shots.length} 个生成器，可在各生成器精修后执行生成`);
  } catch (error) {
    ElMessage.error(readError(error, "生成器组创建失败"));
  } finally {
    creating.value = false;
  }
}
</script>

<style scoped lang="scss">
.scriptSummary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  min-height: 120px;
  overflow: auto;

  .shotRow { display: flex; align-items: center; gap: 8px; font-size: 12px;
    .shotIndex { color: var(--el-text-color-placeholder); font-variant-numeric: tabular-nums; }
    .shotBrief { flex: 1; min-width: 0; color: var(--el-text-color-regular); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .shotSize { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
  }
  .summaryHint { color: var(--el-text-color-secondary); font-size: 12px; }
}

.scriptCard {
  .scriptHeader { display: flex; gap: 8px; margin-bottom: 10px;
    .oneLinerInput { flex: 1; min-width: 0; }
  }
  .breakdownRow { display: flex; gap: 8px; margin-top: 10px;
    .modelSelect { flex: 1; min-width: 0; }
  }
  .shotEditor {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--el-border-color-lighter);
    max-height: 380px;
    overflow: auto;

    .editorHeader { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;
      span { color: var(--el-text-color-regular); font-size: 13px; font-weight: 500;
        small { color: var(--el-text-color-secondary); font-weight: 400; }
      }
      small { color: var(--el-text-color-placeholder); }
    }
    .shotCard { display: grid; gap: 8px; padding: 10px; margin-bottom: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-fill-color-light);
      .shotHead { display: flex; align-items: center; gap: 8px;
        .shotIndex { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
        .sceneInput { flex: 1; min-width: 0; }
        .sizeSelect { width: 84px; }
        .durationInput { width: 104px; }
        .shotActions { margin-left: auto; flex-shrink: 0; }
      }
      .shotMeta { display: flex; gap: 8px;
        .el-input { flex: 1; min-width: 0; }
      }
    }
  }
  .promptFooter { display: flex; gap: 8px; margin-top: 12px; }
}

.errorMessage { color: var(--el-color-danger); font-size: 12px; margin: 8px 0 0; }

.batchDialog {
  display: grid;
  gap: 10px;

  .batchHint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
  .batchModelSelect { width: 100%; }
  .batchRatioSelect { width: 140px; }
}

.assetCount { display: inline-flex; align-items: center; gap: 4px; color: var(--el-text-color-secondary); font-size: 12px; margin-right: 10px; }

.batchRunRow { display: flex; align-items: center; gap: 10px; margin-top: 10px;
  .batchSummary { color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; }
}
</style>
