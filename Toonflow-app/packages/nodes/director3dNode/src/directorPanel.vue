<template>
  <section class="directorPanel" aria-label="动画">
    <header class="chatHeader">
      <icon-sparkles :size="16" aria-hidden="true" />
      <span>方案 <small>{{ plans.length }}</small></span>
      <el-dropdown v-if="plans.length" trigger="click" placement="bottom-end" @command="exportPlans">
        <el-button text size="small" :icon="IconDownload" aria-label="导出分镜表">分镜表</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="md" :icon="IconFileText">Markdown 分镜表</el-dropdown-item>
            <el-dropdown-item command="csv" :icon="IconFileSpreadsheet">CSV 表格</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>
    <div class="planContent">
      <div v-if="plans.length || tasks.length" class="itemList" aria-label="动画列表">
        <button v-for="plan in plans" :key="plan.id" type="button" class="planItem" :class="{ selected: plan.id === selectedPlanId }" :aria-pressed="plan.id === selectedPlanId" @click="emit('selectPlan', plan.id)">
          <icon-movie :size="18" aria-hidden="true" />
          <div class="itemContent">
            <strong>{{ plan.name }}</strong>
            <span>{{ plan.duration }} 秒 · {{ plan.tracks.length }} 条模型动画</span>
            <template v-if="plan.id === selectedPlanId">
              <span>输入提示词</span>
              <p class="planInstruction">{{ plan.instruction || '此旧方案未保存输入提示词' }}</p>
            </template>
          </div>
          <span class="planActions">
            <el-button text circle size="small" :icon="IconCopy" aria-label="复制方案" title="复制方案" @click.stop="emit('duplicatePlan', plan.id)" />
          </span>
          <icon-check v-if="plan.id === selectedPlanId" :size="16" aria-hidden="true" />
        </button>
        <div v-for="task in tasks" :key="task.id" class="planItem taskItem" :aria-busy="!task.error">
          <icon-alert-circle v-if="task.error" :size="18" aria-hidden="true" /><icon-loader-2 v-else class="loadingIcon" :size="18" aria-hidden="true" />
          <div class="itemContent"><strong>{{ task.instruction }}</strong><span v-if="task.error" class="generationError" role="alert">{{ task.error }}</span><span v-else role="status">后台生成中…</span></div>
          <el-button v-if="task.error" text :icon="IconArrowBackUp" aria-label="重新编辑指令" @click="emit('editInstruction', task.instruction)" />
        </div>
      </div>
      <template v-else>
        <p>{{ readonly ? "还没有方案。在「对话」页描述走位或运镜，生成结果会出现在这里。" : "描述模型动作和运镜要求" }}</p>
      </template>
    </div>
    <p class="instructionHint">{{ readonly ? "在「对话」页继续生成新的走位或运镜方案" : referenceCount ? `使用 ${referenceCount} 个关键帧生成运镜` : result ? `参考：${result.name}` : '模型动画与运镜同步生成' }}</p>
    <footer v-if="!readonly" class="chatFooter">
      <div class="inputContent"><slot name="input" /></div>
      <div class="inputActions">
        <el-tooltip :showArrow="false" :content="voiceState === 'recording' ? '停止录音' : '语音指令（说出运镜与走位要求）'" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button class="micButton" :class="{ recording: voiceState === 'recording' }" text circle :icon="voiceState === 'recording' ? IconPlayerStop : IconMicrophone" :aria-label="voiceState === 'recording' ? '停止录音' : '语音指令'" @click="toggleVoice" />
        </el-tooltip>
        <el-select :modelValue="selectedModel ? model : ''" class="modelSelect" size="small" :loading="modelsLoading" filterable placeholder="选择模型" aria-label="生成模型" @update:modelValue="model = $event" @visibleChange="$event && emit('loadModels')">
          <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModel?.providerId" :modelId="selectedModel?.modelId" /></template>
          <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
            <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])">
              <modelLabel :label="item.label" :providerId="item.providerId" :modelId="item.modelId" />
            </el-option>
          </el-option-group>
        </el-select>
        <el-button class="sendButton" type="primary" round :disabled="initializing || !prompt.trim() || !selectedModel" aria-label="生成动画" @click="sendInstruction">
          <icon-sparkles :size="14" /><span>生成方案</span>
        </el-button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref } from "vue";
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessage, ElOption, ElOptionGroup, ElSelect } from "element-plus";
import { IconLoader2, IconSparkles, IconMovie, IconCheck, IconAlertCircle, IconArrowBackUp, IconDownload, IconFileText, IconFileSpreadsheet, IconCopy, IconMicrophone, IconPlayerStop } from "@tabler/icons-vue";
import type { NodeAiModel } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import modelLabel from "@toonflow/node-shared/modelLabel";

import type { DirectorPlan, DirectorPlanItem, DirectorGeneration } from "./sceneAnimation";

const props = defineProps<{ result?: DirectorPlan; referenceCount: number; initializing: boolean; plans: DirectorPlanItem[]; selectedPlanId: string; tasks: DirectorGeneration[]; models: NodeAiModel[]; modelsLoading: boolean; readonly?: boolean }>();
const emit = defineEmits<{ editInstruction: [value: string]; selectPlan: [id: string]; send: []; loadModels: []; duplicatePlan: [id: string] }>();
const prompt = defineModel<string>("prompt", { default: "" });
const model = defineModel<string>("model", { default: "" });
const selectedModel = computed(() => props.models.find(item => JSON.stringify([item.providerId, item.modelId]) === model.value));
const modelGroups = computed(() => groupNodeModels(props.models));
// ACT: 分镜表导出 —— previz 到拍摄文档的标准交付。
function downloadText(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportPlans(format: "md" | "csv") {
  const rows = props.plans.map((plan, index) => ({
    index: String(index + 1).padStart(2, "0"),
    name: plan.name,
    duration: plan.duration.toFixed(2),
    cameraTimes: plan.cameraFrames.map(frame => frame.time.toFixed(2)).join(" → "),
    easings: plan.cameraFrames.map(frame => frame.easing).join("→") || "-",
    tracks: String(plan.tracks.length),
    instruction: plan.instruction ?? "",
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const head = ["序号", "方案", "时长(秒)", "相机关键帧(秒)", "转场", "模型动画轨道", "生成指令"];
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const body = [head, ...rows.map(row => [row.index, row.name, row.duration, row.cameraTimes, row.easings, row.tracks, row.instruction])];
    downloadText(`导演台分镜表-${stamp}.csv`, "\uFEFF" + body.map(row => row.map(escape).join(",")).join("\r\n"), "text/csv");
    return;
  }
  const lines = [
    "# 导演台分镜表",
    "",
    "| 序号 | 方案 | 时长(秒) | 相机关键帧(秒) | 转场 | 模型动画轨道 | 生成指令 |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(row => `| ${row.index} | ${row.name} | ${row.duration} | ${row.cameraTimes} | ${row.easings} | ${row.tracks} | ${row.instruction.replaceAll("\n", " ")} |`),
    "",
  ];
  downloadText(`导演台分镜表-${stamp}.md`, lines.join("\n"), "text/markdown");
}

// ACT: 语音指令驱动走位 —— 浏览器原生语音识别（zh-CN），识别完成自动生成方案。
interface SpeechRecognitionEventLike {
  results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }> & { length: number };
}
const voiceState = ref<"idle" | "recording">("idle");
let recognition: { stop: () => void } | undefined;
onScopeDispose(() => recognition?.stop());

function toggleVoice() {
  if (voiceState.value === "recording") return void recognition?.stop();
  const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
  if (!Ctor) { ElMessage.error("当前浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器"); return; }
  const instance = new Ctor();
  recognition = instance;
  instance.lang = "zh-CN";
  instance.interimResults = false;
  instance.maxAlternatives = 1;
  voiceState.value = "recording";
  instance.onresult = (event: SpeechRecognitionEventLike) => {
    const text = Array.from(event.results).map(result => result[0]?.transcript ?? "").join("").trim();
    if (!text) return;
    prompt.value = prompt.value.trim() ? `${prompt.value.trim()} ${text}` : text;
    sendInstruction();
  };
  instance.onerror = (event: { error?: string }) => {
    voiceState.value = "idle";
    if (event.error === "not-allowed") ElMessage.error("麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试");
    else if (event.error === "no-speech") ElMessage.warning("未听到语音，请再试一次");
    else if (event.error && event.error !== "aborted") ElMessage.error(`语音识别失败：${event.error}`);
  };
  instance.onend = () => { voiceState.value = "idle"; };
  instance.start();
}

function sendInstruction() {
  if (props.initializing || !prompt.value.trim() || !selectedModel.value) return;
  emit("send");
}


interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
</script>

<style scoped lang="scss">
.directorPanel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  color: var(--el-text-color-primary);

  .chatHeader {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 14px;
    font-size: 14px;
    font-weight: 500;
    small { color: var(--el-text-color-secondary); font-weight: 400; }
  }

  .planContent {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
    line-height: 1.7;

    .itemList {
      display: flex; flex-direction: column; gap: 8px;
      .planItem {
        display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px;
        border: 0; border-radius: calc(var(--el-border-radius-base) * 2);
        background: transparent; color: var(--el-text-color-regular); text-align: left; font: inherit;
        &:is(button) { cursor: pointer; }
        &:is(button):hover { background: var(--el-fill-color); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
        &.selected { background: var(--el-fill-color); color: var(--el-text-color-primary); }
        > svg { flex-shrink: 0; }
        .planActions { flex-shrink: 0; margin-left: auto; }
        .itemContent { flex: 1; min-width: 0;
          strong { display: block; font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
          span { display: block; margin-top: 3px; color: var(--el-text-color-secondary); font-size: 11px; }
          .planInstruction { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; user-select: text; }
          .generationError { color: var(--el-color-danger); overflow-wrap: anywhere; }
        }
      }
    }
    h3 { margin: 8px 0; color: var(--el-text-color-primary); font-size: 16px; font-weight: 500; overflow-wrap: anywhere; }
    p { margin: 16px 0; }
    .loadingIcon { animation: directorLoading 1.2s linear infinite; }
  }

  .instructionHint { flex-shrink: 0; margin: 12px; font-size: 11px; line-height: 1.5; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }

  .chatFooter {
    flex-shrink: 0;
    margin: 0 8px 4px;
    padding: 4px;
    border: 1px solid var(--el-border-color-light);
    border-radius: calc(var(--ui-radius, 4px) * 2.75);
    background: var(--el-bg-color);

    &:focus-within { border-color: var(--el-color-primary-light-5); }

    .inputContent {
      padding: 8px;
      min-width: 0;
      :deep(.referenceList) { margin-bottom: 8px; }
    }

    .inputActions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px;

      .modelSelect {
        flex: 1;
        min-width: 0;
        max-width: calc(100% - 112px);

        :deep(.el-select__wrapper) {
          background: transparent;
          box-shadow: none;
          border-radius: var(--el-border-radius-base);

          &:hover:not(.is-disabled) { background: var(--el-fill-color-light); }
          &.is-focused { box-shadow: 0 0 0 1px var(--el-color-primary-light-5) inset; }
        }

        :deep(.el-select__selected-item) { color: var(--el-text-color-regular); }
      }

      .sendButton {
        flex-shrink: 0;
        padding: 0 12px;
        height: 32px;
        margin: 0;
      }
    }
  }
}

@keyframes directorLoading { to { transform: rotate(360deg); } }
@keyframes micPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
@media (prefers-reduced-motion: reduce) { .directorPanel .micButton.recording { animation: none; } }
@media (prefers-reduced-motion: reduce) {
  .directorPanel .planContent .loadingIcon { animation: none; }
}

  .micButton {
    flex-shrink: 0;
    &.recording { color: var(--el-color-danger); animation: micPulse 1.2s ease-in-out infinite; }
  }
</style>
