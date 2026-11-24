<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :bottomWidth="640"
    :style="{ width: '360px' }">
    <div class="synthContent nodrag nopan nowheel" @pointerdown.stop @dblclick.stop>
      <template v-if="clips.length">
        <div class="clipList" aria-label="片段顺序">
          <div v-for="(clip, index) in orderedClips" :key="clip.url" class="clipRow">
            <span class="clipIndex">{{ String(index + 1).padStart(2, "0") }}</span>
            <span class="clipName">{{ clip.label }}</span>
            <span class="clipDuration">{{ clip.duration ? `${clip.duration.toFixed(1)}s` : "…" }}</span>
            <span class="clipOrder">
              <el-button text size="small" :icon="IconArrowUp" :disabled="index === 0 || processing" aria-label="上移" @click="moveClip(index, -1)" />
              <el-button text size="small" :icon="IconArrowDown" :disabled="index === orderedClips.length - 1 || processing" aria-label="下移" @click="moveClip(index, 1)" />
            </span>
          </div>
        </div>
        <div class="synthSettings">
          <label class="settingRow"><span>画幅</span>
            <el-select v-model="settings.ratio" size="small" class="settingInput" aria-label="画幅" :disabled="processing">
              <el-option value="16:9" label="16:9 横屏" />
              <el-option value="9:16" label="9:16 竖屏" />
            </el-select>
          </label>
          <label class="settingRow"><span>分辨率</span>
            <el-select v-model="settings.resolution" size="small" class="settingInput" aria-label="分辨率" :disabled="processing">
              <el-option value="720p" label="720p" />
              <el-option value="1080p" label="1080p" />
            </el-select>
          </label>
          <label v-if="hasBgm" class="settingRow"><span>配乐音量</span>
            <el-slider v-model="settings.bgmVolume" size="small" :min="0" :max="100" :disabled="processing" aria-label="配乐音量" class="settingSlider" />
          </label>
          <label class="settingRow"><span>字幕文件</span>
            <el-switch v-model="settings.subtitlesEnabled" :disabled="processing" aria-label="生成字幕文件" />
            <small class="settingHint">{{ subtitleLines.length ? `${subtitleLines.length} 行台词` : "连接文本节点提供台词" }}</small>
          </label>
        </div>
        <div v-if="processing" class="progressArea" role="status" aria-live="polite">
          <el-progress :percentage="progress" :strokeWidth="4" :showText="false" />
          <p class="statusText">{{ cancelling ? "正在取消…" : progressLabel }} · {{ progress }}%</p>
          <el-button :icon="IconPlayerStop" size="small" :disabled="cancelling" @click="cancel">{{ cancelling ? "正在取消" : "取消" }}</el-button>
        </div>
        <div v-else class="synthActions">
          <el-button type="primary" :icon="IconMovie" :disabled="clips.length < 1" @click="run">开始合成（{{ clips.length }} 段）</el-button>
        </div>
        <p v-if="errorMessage" class="errorMessage" role="alert">{{ errorMessage }}</p>
        <p v-if="resultPath" class="resultHint">成片已生成到画布右侧节点 ✓</p>
      </template>
      <p v-else class="summaryHint">连接两个及以上视频片段节点，即可按顺序拼接、混入配乐并导出成片</p>
    </div>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from "vue";
import { IconArrowDown, IconArrowUp, IconMovie, IconPlayerStop } from "@tabler/icons-vue";
import { ElButton, ElMessage, ElOption, ElProgress, ElSelect, ElSlider, ElSwitch } from "element-plus";
import { getTargetValues, nodeSkeleton, useNode, type NodeHandle, type WorkspaceFiles } from "@toonflow/nodes-scaffold/runtime";
import { useVueFlow } from "@vue-flow/core";

defineOptions({
  inheritAttrs: false,
  icon: IconMovie,
  handles: [
    { id: "in", type: "target", dataType: ["VIDEO", "AUDIO", "STRING"], label: "视频片段、配乐、字幕文本" },
  ] satisfies NodeHandle[],
});

type Clip = { url: string; mimeType: string; label: string };

const { id, node, nodeProps, files, ffmpeg: loadFfmpeg, updateNodeInternals } = useNode({ label: "合成" });
const { addNodes } = useVueFlow();
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
const getDirectory = inject<(() => string) | undefined>("workspaceDirectory", undefined);
const batchHistory = inject<(action: () => Promise<void>) => Promise<void>>("batchCanvasHistory", action => action());

const saved = (node.data as { synthesis?: { ratio?: string; resolution?: string; bgmVolume?: number; subtitlesEnabled?: boolean } }).synthesis;
const settings = reactive({
  ratio: saved?.ratio ?? "16:9",
  resolution: saved?.resolution ?? "720p",
  bgmVolume: typeof saved?.bgmVolume === "number" ? saved.bgmVolume : 40,
  subtitlesEnabled: saved?.subtitlesEnabled !== false,
});
function persist() {
  node.data.synthesis = { ...settings };
}
watch(settings, persist, { deep: true, flush: "sync", immediate: true });

const incoming = computed(() => getTargetValues(id, "in"));
const order = ref<string[]>([]);
const clips = computed<Clip[]>(() => incoming.value.flatMap(item => {
  if (item.dataType !== "VIDEO" || !item.value || typeof item.value !== "object" || !("url" in item.value)) return [];
  const value = item.value as { url: string; mimeType: string };
  return [{ url: value.url, mimeType: value.mimeType, label: value.url.split(/[\\/]/).pop() ?? "片段" }];
}));
watch(clips, list => {
  const known = order.value.filter(url => list.some(item => item.url === url));
  const additions = list.map(item => item.url).filter(url => !known.includes(url));
  order.value = [...known, ...additions];
}, { immediate: true });
const orderedClips = computed(() => order.value.map(url => clips.value.find(item => item.url === url)).filter(Boolean) as Clip[]);
function moveClip(index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= order.value.length) return;
  order.value.splice(to, 0, order.value.splice(index, 1)[0]!);
}

const hasBgm = computed(() => incoming.value.some(item => item.dataType === "AUDIO"));
const bgmPath = computed(() => {
  const audio = incoming.value.find(item => item.dataType === "AUDIO");
  return audio?.value && typeof audio.value === "object" && "url" in audio.value ? (audio.value as { url: string }).url : "";
});
const subtitleLines = computed(() => incoming.value.filter(item => item.dataType === "STRING")
  .flatMap(item => typeof item.value === "string" ? item.value.split("\n") : [])
  .map(line => line.trim()).filter(Boolean));

const dimensions = computed(() => {
  const vertical = settings.ratio === "9:16";
  if (settings.resolution === "1080p") return vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  return vertical ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
});

const processing = ref(false);
const cancelling = ref(false);
const progress = ref(0);
const progressLabel = ref("");
const errorMessage = ref("");
const resultPath = ref("");
const segDurations = ref<number[]>([]);
let controller: AbortController | undefined;

function readError(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return message || (error instanceof Error ? error.message : fallback);
}
function cancel() {
  cancelling.value = true;
  controller?.abort(new Error("合成已取消"));
}

watch([getCanvas, getDirectory], () => { cancel(); processing.value = false; }, { flush: "sync" });

async function probe(factory: BrowserFfmpegFactory, path: string, signal: AbortSignal) {
  return new Promise<{ hasAudio: boolean; duration: number }>((resolve, reject) => {
    factory(path).ffprobe((error: unknown, data: { streams?: { codec_type?: string }[]; format?: { duration?: string } }) => {
      if (error) return reject(error);
      const hasAudio = (data.streams ?? []).some(stream => stream.codec_type === "audio");
      const duration = Number(data.format?.duration) || 0;
      resolve({ hasAudio, duration });
    });
  });
}

function runCommand(command: { kill: () => void; on: (event: string, handler: (...args: unknown[]) => void) => void; run: () => void }, signal: AbortSignal) {
  signal.throwIfAborted();
  const abort = () => command.kill();
  signal.addEventListener("abort", abort, { once: true });
  return new Promise<void>((resolve, reject) => {
    command.on("error", error => reject(signal.aborted ? signal.reason : error));
    command.on("end", () => signal.aborted ? reject(signal.reason) : resolve());
    command.run();
  }).finally(() => signal.removeEventListener("abort", abort));
}

async function run() {
  if (processing.value || orderedClips.value.length < 1) return;
  const current = controller = new AbortController();
  const signal = current.signal;
  processing.value = true;
  cancelling.value = false;
  errorMessage.value = "";
  resultPath.value = "";
  progress.value = 0;
  progressLabel.value = "准备素材…";
  try {
    const ffmpeg = await loadFfmpeg(signal);
    signal.throwIfAborted();
    const workspace: WorkspaceFiles = files.getWorkspaceFiles();
    const directory = getDirectory?.();
    if (!directory) throw new Error("请先选择有效工作区");
    const target = dimensions.value;
    const dir = `assets/synthesis/${crypto.randomUUID().slice(0, 8)}`;
    for (const parent of ["assets", "assets/synthesis", dir]) {
      await workspace.mkdir(parent).catch(error => {
        if (error?.response?.data?.data?.code !== "EEXIST") throw error;
      });
    }
    segDurations.value = [];
    // 第一遍：统一规格（分辨率/帧率/像素格式/音轨），保证可无损拼接。
    for (let index = 0; index < orderedClips.value.length; index += 1) {
      signal.throwIfAborted();
      progressLabel.value = `统一规格 ${index + 1}/${orderedClips.value.length}`;
      const clip = orderedClips.value[index];
      const info = await probe(ffmpeg, clip.url, signal);
      const command = ffmpeg(clip.url)
        .addInput("anullsrc=channel_layout=stereo:sample_rate=44100")
        .outputOptions(
          "-map", "0:v:0", "-map", info.hasAudio ? "0:a:0" : "1:a:0",
          "-vf", `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,
          "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
          "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest", "-movflags", "+faststart",
        )
        .output(`${dir}/seg${index}.mp4`);
      await runCommand(command, signal);
      const segInfo = await probe(ffmpeg, `${dir}/seg${index}.mp4`, signal);
      segDurations.value.push(segInfo.duration || info.duration || 0);
      progress.value = Math.round((index + 1) / orderedClips.value.length * 60);
    }
    signal.throwIfAborted();
    // 第二遍：按顺序拼接。
    progressLabel.value = "按顺序拼接…";
    const segCount = orderedClips.value.length;
    const concatCommand = ffmpeg(`${dir}/seg0.mp4`);
    for (let index = 1; index < segCount; index += 1) concatCommand.addInput(`${dir}/seg${index}.mp4`);
    concatCommand
      .outputOptions(
        "-filter_complex", `concat=n=${segCount}:v=1:a=1[merged]`,
        "-map", "[merged]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
      )
      .output(`${dir}/merged.mp4`);
    await runCommand(concatCommand, signal);
    progress.value = 85;
    // 第三遍：混入配乐。
    let finalPath = `${dir}/merged.mp4`;
    if (bgmPath.value) {
      signal.throwIfAborted();
      progressLabel.value = "混入配乐…";
      const volume = Math.max(0, Math.min(1, settings.bgmVolume / 100));
      const mixCommand = ffmpeg(finalPath)
        .addInput(bgmPath.value)
        .outputOptions(
          "-filter_complex", `[0:a]volume=1.0[va];[1:a]volume=${volume}[bg];[va][bg]amix=inputs=2:duration=first[aout]`,
          "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart",
        )
        .output(`${dir}/final.mp4`);
      await runCommand(mixCommand, signal);
      finalPath = `${dir}/final.mp4`;
    }
    progress.value = 95;
    signal.throwIfAborted();
    // 生成成片节点与字幕文件。
    await batchHistory(async () => {
      signal.throwIfAborted();
      const nodeId = crypto.randomUUID();
      addNodes([{
        id: nodeId,
        type: "remote-videoNode",
        position: { x: node.computedPosition.x + (node.dimensions.width || 360) + 96, y: node.computedPosition.y },
        data: {
          label: `成片 · ${orderedClips.value.length} 段 · ${settings.resolution}`,
          outputs: { video: { dataType: "VIDEO", value: { url: finalPath, mimeType: "video/mp4" } } },
        },
      }]);
    });
    if (settings.subtitlesEnabled && subtitleLines.value.length) {
      const srt = buildSrt(subtitleLines.value, segDurations.value.length ? segDurations.value : orderedClips.value.map(() => 5));
      downloadText(`成片字幕-${stamp()}.srt`, srt, "application/x-subrip");
    }
    resultPath.value = finalPath;
    progress.value = 100;
    progressLabel.value = "合成完成";
    ElMessage.success("成片已生成到画布");
    await nextTick();
    updateNodeInternals();
  } catch (error) {
    if (processing.value) errorMessage.value = readError(error, "合成失败");
  } finally {
    processing.value = false;
    cancelling.value = false;
    controller = undefined;
  }
}

function buildSrt(lines: string[], durations: number[]) {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const stampTime = (seconds: number) => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor(ms % 3600000 / 60000);
    const secs = Math.floor(ms % 60000 / 1000);
    const millis = ms % 1000;
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
  };
  let cursor = 0;
  const entries: string[] = [];
  lines.forEach((line, index) => {
    const clipIndex = Math.min(index, durations.length - 1);
    const start = cursor;
    const end = start + (durations[clipIndex] || 5);
    cursor = end;
    entries.push(`${index + 1}\n${stampTime(start)} --> ${stampTime(end)}\n${line}`);
  });
  return entries.join("\n\n");
}

function stamp() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

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
</script>

<style scoped lang="scss">
.synthContent {
  padding: 10px 12px;
  min-height: 140px;

  .clipList { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;
    .clipRow { display: flex; align-items: center; gap: 8px; font-size: 12px;
      .clipIndex { color: var(--el-text-color-placeholder); font-variant-numeric: tabular-nums; }
      .clipName { flex: 1; min-width: 0; color: var(--el-text-color-regular); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .clipDuration { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
      .clipOrder { display: flex; }
    }
  }
  .synthSettings { display: grid; gap: 8px; margin-bottom: 12px;
    .settingRow { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--el-text-color-regular);
      > span:first-child { width: 64px; color: var(--el-text-color-secondary); }
      .settingInput { flex: 1; }
      .settingSlider { flex: 1; }
      .settingHint { color: var(--el-text-color-placeholder); font-size: 11px; }
    }
  }
  .progressArea { display: grid; gap: 8px; }
  .statusText { color: var(--el-text-color-secondary); font-size: 12px; }
  .synthActions { margin-top: 4px; }
  .errorMessage { color: var(--el-color-danger); font-size: 12px; }
  .resultHint { color: var(--el-color-success); font-size: 12px; }
  .summaryHint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
}
</style>
