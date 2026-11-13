<template>
  <nodeSkeleton
    v-bind="nodeProps"
    :topVisible="node.selected"
    :bottomVisible="node.selected"
    :bottomWidth="actions?.mode === 'speed' ? 440 : 660"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    :fullscreenVisible="false"
    style="width: 360px">
    <template #topActions>
      <el-button :icon="IconTextRecognition" :loading="transcribing" :disabled="busy || !outputFile" text title="音频转文本" aria-label="音频转文本" @click.stop="transcribe">转文本</el-button>
      <el-button v-if="transcribing" :icon="IconPlayerStop" text title="取消转文本" aria-label="取消转文本" @click.stop="cancelTranscription">取消</el-button>
      <el-button :icon="IconScissors" :disabled="busy || !previewUrl" text title="截取音频" aria-label="截取音频" @click.stop="actions?.open('clip')">截取</el-button>
      <el-button :icon="IconGauge" :disabled="busy || !previewUrl" text title="音频变速" aria-label="音频变速" @click.stop="actions?.open('speed')">变速</el-button>
      <el-button :icon="IconTransfer" :loading="uploading" :disabled="busy" text title="替换音频" aria-label="替换音频" @click.stop="fileInput?.click()">替换音频</el-button>
      <el-button :icon="IconMicrophone" text title="管理音色库" aria-label="管理音色库" @click.stop="openVoicePanel">音色</el-button>
      <input ref="fileInput" type="file" accept="audio/*" hidden aria-label="选择替换音频" :disabled="busy" @change="replaceOutput" />
    </template>
    <div v-loading="generating || uploading" class="audioContent nopan" :aria-busy="generating || uploading">
      <audioPlayer v-if="previewUrl" ref="player" v-model:pcmOptions="pcmOptions" class="audioPreview" :src="previewUrl" :mimeType="outputFile?.mimeType" @loadedmetadata="updateNodeInternals" />
      <div v-else class="audioEmpty" role="img" aria-label="暂无生成音频"><icon-music-bolt :size="48" stroke="1.25" aria-hidden="true" /></div>
    </div>
    <template #bottom>
      <div v-if="actions?.mode === 'speed'" ref="speedTarget" />
      <el-card v-else class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <referenceItem v-if="refList.length" v-model="refList" @preview="setReferencePreview" @remove="removeReference" />
        <promptInput v-model="data.promptModel" v-model:text="data.prompt" :references="referenceMentions" :materials="materialMentions" :selectMaterial="selectMaterialReference" :selectAsset="selectAssetReference" placeholder="描述您想要的音频效果或输入待朗读文本" expandable />
        <div class="promptFooter">
          <el-select
            :modelValue="selectedModel ? data.model : ''"
            class="modelSelect"
            filterable
            :loading="modelsLoading"
            :disabled="busy"
            placeholder="选择模型"
            aria-label="音频生成模型"
            noDataText="请先在设置中添加音频模型"
            placement="top-start"
            @update:modelValue="data.model = $event"
            @visible-change="visible => visible && loadModels().catch(error => showNodeError(error, '模型读取失败'))">
            <template v-if="!selectedModel" #prefix><icon-music-bolt :size="17" /></template>
            <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModel?.providerId" :modelId="selectedModel?.modelId" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])">
                <modelLabel :label="item.label" :providerId="item.providerId" :modelId="item.modelId" />
              </el-option>
            </el-option-group>
          </el-select>
          <generationSettings v-model:language="data.language" v-model:sampleRate="data.sampleRate" v-model:format="data.format" v-model:other="data.other" :model="selectedModel" :disabled="busy || !selectedModel" />
          <div class="generationActions">
            <mediaPrice v-if="generationInput" :input="{ ...generationInput, mediaType: 'audio' }" :supported="selectedModel?.supportsPrice === true" />
            <el-button v-if="pendingRecovery" class="sendButton" :icon="IconPlayerStop" :loading="cancelling" :disabled="deleting || uploading || transcribing || actions?.processing" title="放弃任务" aria-label="放弃任务" @click="generationState.cancel().catch(error => showNodeError(error, '停止生成失败'))" />
            <el-button
              class="sendButton"
              :icon="generating ? IconPlayerStop : IconArrowUp"
              :disabled="cancelling || deleting || uploading || transcribing || actions?.processing || (!generating && !pendingRecovery && (!generationPrompt || !selectedModel))"
              :title="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成音频'"
              :aria-label="generating ? '停止生成' : pendingRecovery ? '复查任务' : '生成音频'"
              @click="generating ? generationState.cancel().catch(error => showNodeError(error, '停止生成失败')) : startGeneration().catch(error => showNodeError(error, '音频生成失败'))" />
          </div>
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
  <audioActions ref="actions" v-model:pcmOptions="pcmOptions" :file="outputFile" :src="previewUrl" :target="speedTarget" :disabled="generating || deleting || uploading || transcribing" @pause="player?.pause()" />
  <teleport to="body">
    <div v-if="voicePanel" class="voiceMask" @click.self="closeVoicePanel">
      <div class="voiceBox">
        <div class="voiceHead">
          <span>音色库</span>
          <button class="voiceClose" type="button" aria-label="关闭音色库" @click="closeVoicePanel">关闭</button>
        </div>
        <div class="voiceBody">
          <div class="voiceForm">
            <div class="voiceField"><label>音色 ID</label><input v-model="voiceForm.id" placeholder="lingqingyan" /></div>
            <div class="voiceField"><label>显示名</label><input v-model="voiceForm.name" placeholder="凌清砚" /></div>
            <div class="voiceField"><label>逐字文本（与音频一字不差）</label><textarea v-model="voiceForm.text" placeholder="你听见云层裂开的声音了吗" /></div>
            <div class="voiceField"><label>参考音频（10–30 秒，单人无背景音）</label><input type="file" accept="audio/*" @change="onVoiceFile" /></div>
            <div class="voiceActions">
              <button class="voicePrimary" type="button" :disabled="voiceBusy" @click="saveVoice">{{ voiceBusy ? '处理中…' : '保存音色' }}</button>
              <span class="voiceMsg">{{ voiceMsg }}</span>
            </div>
          </div>
          <div class="voiceList">
            <div class="voiceBatch">
              <input v-model="sampleText" class="voiceBatchInput" placeholder="批量试听文本（同一文本的样音会缓存）" @keydown.stop @pointerdown.stop />
              <div class="voiceBatchActions">
                <button class="voicePrimary" type="button" :disabled="batchBusy || !voices.length" @click="generateAllSamples">{{ batchBusy ? '生成中…' : '生成全部样音' }}</button>
                <button v-if="playingIndex >= 0" class="voiceDanger" type="button" @click="stopPlayback">停止连播</button>
                <button v-else class="voiceGhost" type="button" :disabled="batchBusy || !voices.length" @click="playAll">连播对比</button>
                <span v-if="batchProgress" class="voiceBatchMsg">{{ batchProgress }}</span>
              </div>
            </div>
            <div v-for="(item, index) in voices" :key="item.voiceId" class="voiceItem" :class="{ voicePlaying: playingIndex === index }">
              <div class="voiceMeta"><b>{{ item.name || item.voiceId }}</b><span>{{ item.voiceId }}<template v-if="item.seconds"> · {{ item.seconds }} 秒</template></span></div>
              <button class="voiceGhost" type="button" @click="playRef(item.voiceId)">参考</button>
              <button class="voiceGhost" type="button" :disabled="voiceBusy" @click="playClone(item.voiceId)">试听克隆</button>
              <button class="voiceDanger" type="button" @click="removeVoice(item.voiceId)">删除</button>
            </div>
            <div v-if="!voices.length" class="voiceEmpty">还没有音色，先在上面上传一个</div>
          </div>
          <audio v-if="voicePreview" ref="voicePlayer" :src="voicePreview" controls class="voicePlayer" @ended="onPreviewEnded" />
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ElButton, ElCard, ElLoading, ElOption, ElOptionGroup, ElSelect } from "element-plus";
import { IconArrowUp, IconGauge, IconMusicBolt, IconPlayerStop, IconScissors, IconTransfer, IconMicrophone, IconTextRecognition } from "@tabler/icons-vue";
import { getTargetValues, isTypeCompatible, nodeSkeleton, nodeTools, useNode, z, type NodeAudioRequest, type NodeHandle, type NodeInputValue, type NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import modelLabel from "@toonflow/node-shared/modelLabel";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { useNodeGeneration } from "@toonflow/node-shared/useNodeGeneration";
import { useAudioTranscription } from "@toonflow/node-shared/useAudioTranscription";
import { getMediaMimeType } from "@toonflow/node-shared/mediaTypes";
import type { PcmOptions } from "@toonflow/node-shared/pcmPreview";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import { useModelForm } from "@toonflow/node-shared/useModelForm";
import audioPlayer from "@toonflow/node-audio/audioPlayer";
import audioActions from "@toonflow/node-audio/audioActions";
import promptInput from "@toonflow/node-shared/promptInput";
import referenceItem from "@toonflow/node-shared/referenceItem";
import mediaPrice from "@toonflow/node-shared/mediaPrice";
import generationSettings from "./components/generationSettings.vue";
import { formatOptions, languageOptions, sampleRateOptions } from "./audioSettings";

defineOptions({
  inheritAttrs: false,
  icon: IconMusicBolt,
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "AUDIO", "STRING"], label: "图片或音频限1个，文本不限" },
    { id: "audio", type: "source", dataType: "AUDIO", label: "音频输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, outputs, files, ai, updateNodeInternals } = useNode({ label: "音频生成" });
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const data = computed(() => node.data as { prompt: string; promptModel: PromptModel; model: string; language: string; sampleRate: number; format: string; other: Record<string, unknown> });
data.value.prompt ??= "";
data.value.promptModel ??= [];
data.value.model ??= "";
data.value.language ??= "zh-CN";
data.value.sampleRate ??= 24000;
data.value.format ??= "wav";
data.value.other ??= {};
const { refList, referenceMentions, materialMentions, selectMaterialReference, selectAssetReference, setReferencePreview, removeReference } = useNodeReferences();
const models = shallowRef<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const uploading = ref(false);
const deleting = ref(false);
const fileInput = ref<HTMLInputElement>();

const voicePanel = ref(false);
const voices = ref<Array<{ voiceId: string; name?: string; description?: string; seconds?: number | null }>>([]);
const voiceForm = ref({ id: "", name: "", text: "" });
const voiceFile = ref<File | null>(null);
const voiceBusy = ref(false);
const voiceMsg = ref("");
const voicePreview = ref("");

function openVoicePanel() {
  voicePanel.value = true;
  voiceMsg.value = "";
  refreshVoices();
}
function closeVoicePanel() {
  voicePanel.value = false;
  loadModels().catch(() => {});
}
async function refreshVoices() {
  try {
    const response = await fetch("/api/audio/voices");
    const payload = await response.json();
    voices.value = Array.isArray(payload?.voices) ? payload.voices : [];
  } catch {
    voiceMsg.value = "本地音色服务不可达";
  }
}
function onVoiceFile(event: Event) {
  const input = event.target as HTMLInputElement;
  voiceFile.value = input.files?.[0] ?? null;
}
async function saveVoice() {
  if (!voiceForm.value.id.trim()) { voiceMsg.value = "请填写音色 ID"; return; }
  if (!voiceForm.value.text.trim()) { voiceMsg.value = "请填写逐字文本"; return; }
  if (!voiceFile.value) { voiceMsg.value = "请选择参考音频"; return; }
  voiceBusy.value = true;
  voiceMsg.value = "上传中…";
  try {
    const form = new FormData();
    form.append("voiceId", voiceForm.value.id.trim());
    form.append("name", voiceForm.value.name.trim());
    form.append("promptText", voiceForm.value.text.trim());
    form.append("file", voiceFile.value);
    const response = await fetch("/api/audio/voices", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || payload?.detail || "上传失败");
    voiceMsg.value = `已保存 ${payload.voiceId}（${payload.seconds} 秒）`;
    voiceForm.value = { id: "", name: "", text: "" };
    voiceFile.value = null;
    await refreshVoices();
    await loadModels().catch(() => {});
  } catch (error) {
    voiceMsg.value = error instanceof Error ? error.message : String(error);
  } finally {
    voiceBusy.value = false;
  }
}
function playRef(voiceId: string) {
  voicePreview.value = `/api/audio/voices/${encodeURIComponent(voiceId)}/ref?t=${Date.now()}`;
}
async function playClone(voiceId: string) {
  if (playingIndex.value >= 0) stopPlayback();
  voiceBusy.value = true;
  voiceMsg.value = "合成试听中…";
  try {
    const text = voiceForm.value.text.trim() || "这句话是用来试听克隆效果的，听听像不像。";
    const response = await fetch(`/api/audio/voices/${encodeURIComponent(voiceId)}/sample`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error((await response.json())?.message || "合成失败");
    voiceMsg.value = "";
    voicePreview.value = `/api/audio/voices/${encodeURIComponent(voiceId)}/sample?t=${Date.now()}`;
  } catch (error) {
    voiceMsg.value = error instanceof Error ? error.message : String(error);
  } finally {
    voiceBusy.value = false;
  }
}

// ACT: 批量对比 —— 同一文本为全部音色生成样音（服务端按文本缓存），连播便于横向挑选。
const sampleText = ref("这句话是用来试听克隆效果的，听听像不像。");
const batchBusy = ref(false);
const batchProgress = ref("");
const playQueue = ref<string[]>([]);
const playingIndex = ref(-1);
const voicePlayer = ref<HTMLAudioElement>();

watch(voicePreview, async () => {
  if (playingIndex.value < 0) return;
  await nextTick();
  voicePlayer.value?.play().catch(() => {});
});

function stopPlayback() {
  playingIndex.value = -1;
  playQueue.value = [];
  voicePlayer.value?.pause();
}

function onPreviewEnded() {
  if (playingIndex.value < 0) return;
  const next = playingIndex.value + 1;
  if (next >= playQueue.value.length) return void stopPlayback();
  playingIndex.value = next;
  voicePreview.value = playQueue.value[next] ?? "";
}

function playAll() {
  if (!voices.value.length) { voiceMsg.value = "音色库为空，先上传音色"; return; }
  playQueue.value = voices.value.map(item => `/api/audio/voices/${encodeURIComponent(item.voiceId)}/sample?t=${Date.now()}`);
  playingIndex.value = 0;
  voiceMsg.value = "";
  voicePreview.value = playQueue.value[0] ?? "";
}

async function generateAllSamples() {
  if (batchBusy.value) return;
  if (!voices.value.length) { voiceMsg.value = "音色库为空，先上传音色"; return; }
  batchBusy.value = true;
  const text = sampleText.value.trim();
  try {
    for (let index = 0; index < voices.value.length; index += 1) {
      const item = voices.value[index];
      batchProgress.value = `生成样音 ${index + 1}/${voices.value.length}：${item.name || item.voiceId}…`;
      const response = await fetch(`/api/audio/voices/${encodeURIComponent(item.voiceId)}/sample`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(text ? { text } : {}),
      });
      if (!response.ok) throw new Error(`${item.name || item.voiceId}：${(await response.json())?.message || "样音生成失败"}`);
    }
    batchProgress.value = `全部样音就绪（${voices.value.length} 个）`;
  } catch (error) {
    batchProgress.value = "";
    voiceMsg.value = error instanceof Error ? error.message : String(error);
  } finally {
    batchBusy.value = false;
  }
}

onScopeDispose(stopPlayback);
async function removeVoice(voiceId: string) {
  if (!confirm(`删除音色 ${voiceId}？`)) return;
  await fetch(`/api/audio/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE" });
  await refreshVoices();
  await loadModels().catch(() => {});
}
const player = ref<InstanceType<typeof audioPlayer>>();
const actions = ref<InstanceType<typeof audioActions>>();
const speedTarget = ref<HTMLElement>();
const outputFile = computed(() => outputs.value.audio?.dataType === "AUDIO" ? outputs.value.audio.value : undefined);
const pcmOptions = ref<Partial<PcmOptions>>({});
watch(() => outputFile.value?.url, () => { pcmOptions.value = {}; }, { flush: "sync" });
const { processing: transcribing, transcribe, cancel: cancelTranscription, cancelAndWait: cancelTranscriptionAndWait } = useAudioTranscription(outputFile);
let disposed = false;
let generationController: AbortController | undefined;
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
let modelsRefreshPending = false;
const generationState = useNodeGeneration(outputs, () => generationController?.abort(), { ai });
const { generating, pendingRecovery, cancelling } = generationState;
const busy = computed(() => generating.value || uploading.value || deleting.value || transcribing.value || !!actions.value?.processing);
watch(busy, value => { if (!value && modelsRefreshPending) void refreshProviderModels(); });
const selectedModel = computed(() => models.value.find(item => JSON.stringify([item.providerId, item.modelId]) === data.value.model));
useModelForm(data, selectedModel);
const modelGroups = computed(() => groupNodeModels(models.value));
const generationPrompt = computed(() => [data.value.prompt.trim(), ...refList.value.flatMap((item, index) =>
  item.dataType === "STRING" && item.value?.trim() ? [`参考 ${index + 1}：\n${item.value.trim()}`] : [])].filter(Boolean).join("\n\n"));
const generationInput = computed<Omit<NodeAudioRequest, "directory"> | undefined>(() => {
  const choice = selectedModel.value;
  if (!choice) return;
  return {
    providerId: choice.providerId,
    modelId: choice.modelId,
    prompt: generationPrompt.value,
    language: data.value.language,
    sampleRate: data.value.sampleRate,
    format: data.value.format,
    other: Object.keys(data.value.other).length ? { ...data.value.other } : undefined,
    outputDirectory: `assets/${id}`,
    images: refList.value.flatMap(item => item.dataType === "IMAGE" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []),
    audios: refList.value.flatMap(item => item.dataType === "AUDIO" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []),
  };
});
const previewUrl = files.useFileUrl(outputFile, error => showNodeError(error, "音频读取失败"));

function referencesAllowed(values: NodeInputValue[]) {
  return values.filter(item => isTypeCompatible(item.dataType, ["IMAGE", "AUDIO"])).length <= 1;
}

nodeEvent.on("canConnect", (connection, context) => {
  // ACT: 重验已有连线时不重复计数；未产出内容的来源仍按声明类型占位。
  const edges = context.edges.filter(edge => edge.source !== connection.source || edge.sourceHandle !== connection.sourceHandle
    || edge.target !== connection.target || edge.targetHandle !== connection.targetHandle);
  return referencesAllowed(getTargetValues(id, "in", context.nodes, [...edges, connection]));
});

onMounted(() => {
  window.addEventListener("toonflow:plugin-installed", refreshProviderModels);
  window.addEventListener("toonflow:provider-config-changed", refreshProviderModels);
  void refreshProviderModels();
});
onScopeDispose(() => {
  disposed = true;
  window.removeEventListener("toonflow:plugin-installed", refreshProviderModels);
  window.removeEventListener("toonflow:provider-config-changed", refreshProviderModels);
  generationController?.abort();
});

async function refreshProviderModels(event?: Event) {
  if (event?.type === "toonflow:plugin-installed" && (event as CustomEvent<{ type?: string }>).detail?.type !== "provider") return;
  modelsRefreshPending = true;
  if (disposed || busy.value) return;
  try {
    await modelsRequest;
    if (disposed || busy.value) return;
    modelsRefreshPending = false;
    await loadModels();
  } catch (error) {
    if (!disposed) showNodeError(error, "模型读取失败");
  }
}

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then(items => {
    if (disposed) return;
    if (busy.value) {
      modelsRefreshPending = true;
      return;
    }
    models.value = items.filter(item => item.type === "audio");
    // ACT: 仅空配置选择默认模型，临时不可用的模型保持原选择，避免静默换供应商。
    if (!data.value.model) {
      const first = modelGroups.value[0]?.models[0];
      data.value.model = first ? JSON.stringify([first.providerId, first.modelId]) : "";
    }
  }).finally(() => {
    modelsLoading.value = false;
    modelsRequest = undefined;
  });
  return modelsRequest;
}

async function startGeneration() {
  if (cancelling.value) throw new Error("任务正在取消，请稍后重试");
  if (busy.value || disposed) throw new Error("音频正在处理或节点已关闭，请稍后重试");
  if (pendingRecovery.value) {
    generation = generationState.resume().catch(error => showNodeError(error, "音频任务复查失败"));
    return { status: "generating" };
  }
  const input = generationInput.value;
  if (!input) throw new Error("请先选择音频模型");
  if (!generationPrompt.value) throw new Error("请输入生成提示词或待朗读文本");
  if (!referencesAllowed(refList.value)) throw new Error("图片和音频不能同时引用，且合计最多引用一个；文本数量不限");
  if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  if (!languageOptions.some(item => item.value === data.value.language) || !sampleRateOptions.includes(data.value.sampleRate) || !formatOptions.includes(data.value.format)) throw new Error("请重新选择有效的语种、采样率和输出格式");
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  generationController = controller;
  generation = generationState.run(async () => {
    const { directory } = await workspace.list();
    controller.signal.throwIfAborted();
    const [result] = await generationState.generate("audio", { ...input, directory }, controller.signal);
    controller.signal.throwIfAborted();
    if (!result) throw new Error("供应商未返回音频");
    outputs.value.audio = { dataType: "AUDIO", value: { url: result.path, mimeType: result.mimeType } };
  }).catch(error => showNodeError(error, "音频生成失败")).finally(() => {
    generationController = undefined;
  });
  return { status: "generating" };
}

async function replaceOutput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || busy.value || disposed) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("audio/")) return void showNodeError("请选择音频文件", "音频替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("音频不能为空且不能超过 100 MB", "音频替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 替换不删除旧音频，保留复制节点与撤销记录的文件引用。
    outputs.value.audio = { dataType: "AUDIO", value: { url, mimeType } };
  } catch (error) {
    showNodeError(error, "音频替换失败");
  } finally {
    uploading.value = false;
  }
}

nodeEvent.on("save", reason => {
  if (uploading.value || (reason === "reload" && busy.value)) throw new Error("音频处理中，请完成或取消后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (uploading.value) throw new Error("音频正在替换，请稍后删除节点");
  deleting.value = true;
  try {
    await generationState.cancel(false);
    await Promise.all([generation, actions.value?.cancelAndWait(), cancelTranscriptionAndWait()]);
    await files.removeNodeFiles();
  } finally {
    deleting.value = false;
  }
});

function getConfig() {
  return {
    config: { providerId: selectedModel.value?.providerId ?? "", modelId: selectedModel.value?.modelId ?? "", language: data.value.language, sampleRate: data.value.sampleRate, format: data.value.format, other: { ...data.value.other } },
    models: models.value,
    languages: languageOptions,
    sampleRates: sampleRateOptions,
    formats: formatOptions,
    inputLimits: { text: "unlimited", imageOrAudio: 1 },
  };
}

nodeTools.register({
  name: "getConfig",
  description: "读取此音频生成节点的配置、可选音频模型、语种、采样率、输出格式与输入数量限制，不含密钥；文本不限，图片与音频互斥且合计最多一个，具体模型能力由供应商校验",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    signal?.throwIfAborted();
    return getConfig();
  },
});
nodeTools.register({
  name: "setConfig",
  description: "修改音频生成模型、语种、采样率或格式；先用 getConfig 查询选项，providerId 与 modelId 必须同时提供；不修改提示词、不启动生成",
  parameters: z.strictObject({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    language: z.string().optional(),
    sampleRate: z.number().int().positive().optional(),
    format: z.string().optional(),
  }).refine(args => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供"),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    if (busy.value || disposed) throw new Error("音频正在处理或节点已关闭，请稍后修改配置");
    await loadModels();
    signal?.throwIfAborted();
    if (busy.value || disposed) throw new Error("音频正在处理或节点已关闭，请稍后修改配置");
    const choice = args.modelId === undefined ? selectedModel.value : models.value.find(item => item.providerId === args.providerId && item.modelId === args.modelId);
    if (!choice) throw new Error("请选择 getConfig 返回的有效音频模型");
    if (args.language !== undefined && !languageOptions.some(item => item.value === args.language)) throw new Error("请选择 getConfig 返回的有效语种");
    if (args.sampleRate !== undefined && !sampleRateOptions.includes(args.sampleRate)) throw new Error("请选择 getConfig 返回的有效采样率");
    if (args.format !== undefined && !formatOptions.includes(args.format)) throw new Error("请选择 getConfig 返回的有效输出格式");
    data.value.model = JSON.stringify([choice.providerId, choice.modelId]);
    if (args.language !== undefined) data.value.language = args.language;
    if (args.sampleRate !== undefined) data.value.sampleRate = args.sampleRate;
    if (args.format !== undefined) data.value.format = args.format;
    return getConfig();
  },
});
nodeTools.register({
  name: "setPrompt",
  description: "修改此节点的音频生成提示词或待朗读文本，仅接收 prompt，支持 {{ref 1}} 等参考标记；语种 language、采样率 sampleRate、格式 format 等配置须先用 node:getConfig 查询能力，再单独调用 node:setConfig；不启动生成",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt }) {
    if (deleting.value || disposed) throw new Error("节点正在删除或已关闭，请稍后修改");
    data.value.prompt = prompt;
    data.value.promptModel = prompt.split("\n").map(text => [{ type: "Write", text }]);
    return { prompt };
  },
});
nodeTools.register({
  name: "generateAudio",
  description: "使用当前提示词、模型、语种、采样率、格式和可选参考图片或音频启动后台生成；图片与音频互斥且合计最多一个，文本不限；立即返回已开始，用 getGenerationStatus 查询结果、cancelGeneration 停止",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    return startGeneration();
  },
});
</script>

<style scoped lang="scss">
.audioContent {
  position: relative;
  min-height: 144px;
  display: flex;
  align-items: center;

  .nodeSkeleton.resized & {
    height: 100%;
    min-height: 0;
    align-items: flex-start;

    .audioEmpty { height: 100%; min-height: 0; }
  }

  .audioPreview { display: block; width: 100%; border-radius: var(--el-border-radius-base); }
  .audioEmpty { display: grid; place-items: center; width: 100%; min-height: 144px; color: var(--el-text-color-placeholder); }
  :deep(.el-loading-mask) { pointer-events: none; }
}
.promptCard {
  .promptFooter {
    display: flex;
    align-items: center;
    gap: 12px;

    .modelSelect {
      width: 280px;
      min-width: 0;
      &:deep(.el-select__wrapper) { gap: 6px; padding: 0; box-shadow: none; background: transparent; }
    }
    .generationActions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;

      .sendButton {
        width: 32px;
        height: 32px;
        margin-left: 0;
        padding: 0;
        --el-button-bg-color: var(--el-text-color-primary);
        --el-button-border-color: transparent;
        --el-button-text-color: var(--el-bg-color);
        --el-button-hover-bg-color: var(--el-text-color-regular);
        --el-button-hover-border-color: transparent;
        --el-button-hover-text-color: var(--el-bg-color);
      }
    }
  }
}

.voiceMask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 18, 25, 0.45);
}
.voiceBox {
  width: min(960px, 92vw);
  height: min(760px, 86vh);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background: var(--el-bg-color, #fff);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
}
.voiceHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
}
.voiceClose {
  border: 0;
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.voiceFrame {
  flex: 1;
  width: 100%;
  border: 0;
}
.voiceHint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 13px;
  line-height: 1.8;
  text-align: center;
}

.voiceBody {
  flex: 1;
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
  padding: 16px;
  overflow: hidden;
}
.voiceForm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.voiceField label {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  margin-bottom: 4px;
}
.voiceField input,
.voiceField textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  padding: 7px 9px;
  font: inherit;
  font-size: 13px;
  color: var(--el-text-color-primary, #303133);
  background: var(--el-bg-color, #fff);
}
.voiceField textarea {
  min-height: 72px;
  resize: vertical;
}
.voiceActions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}
.voicePrimary {
  border: 0;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  color: #fff;
  background: var(--el-color-primary, #409eff);
  cursor: pointer;
}
.voicePrimary:disabled {
  background: var(--el-color-primary-light-5, #a0cfff);
  cursor: not-allowed;
}
.voiceMsg {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.voiceList {
  overflow-y: auto;
  border-left: 1px solid var(--el-border-color-lighter, #ebeef5);
  padding-left: 16px;
}
.voiceItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
}
.voiceMeta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.voiceMeta span {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.voiceGhost,
.voiceDanger {
  border: 0;
  border-radius: 5px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}
.voiceGhost {
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
}
.voiceDanger {
  background: var(--el-color-danger-light-9, #fef0f0);
  color: var(--el-color-danger, #f56c6c);
}
.voiceEmpty {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.voicePlayer {
  width: 100%;
  margin-top: 12px;
}

.voiceBatch {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px dashed var(--el-border-color, #dcdfe6);
  border-radius: 8px;
  margin-bottom: 10px;
}

.voiceBatchInput {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  padding: 7px 9px;
  font: inherit;
  font-size: 12px;
  color: var(--el-text-color-primary, #303133);
  background: var(--el-bg-color, #fff);
}

.voiceBatchActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.voiceBatchMsg {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}

.voiceItem.voicePlaying {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: -2px;
  border-radius: 8px;
}
</style>
