<template>
  <nodeSkeleton
    v-bind="nodeProps"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="exporting ? '' : previewUrl"
    :downloadPending="!exporting && !!outputFile && !previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    :style="{ width: previewUrl && videoWidth ? `${videoWidth + 18}px` : undefined }"
    @download="downloadVideo"
    @fullscreen="enterFullscreen">
    <template #topActions>
      <el-button :icon="IconMusic" text :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="openAction('extractAudio')">提取音轨</el-button>
      <el-button :icon="IconLayersSubtract" text :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="openAction('separate')">分离音视频</el-button>
      <el-button :icon="IconScissors" text :disabled="!outputFile || uploading || exporting || actions?.processing" @click.stop="openAction('trim')">截取片段</el-button>
      <el-button :icon="IconMovie" text :loading="actions?.creatingAnalysis" :disabled="!outputFile || uploading || exporting || actions?.processing || actions?.creatingAnalysis" @click.stop="actions?.createFrameAnalysis()">逐帧拉片</el-button>
      <el-button
        :icon="IconTransfer"
        :loading="uploading"
        :disabled="exporting"
        text
        title="替换视频"
        aria-label="替换视频"
        @click.stop="fileInput?.click()">替换视频</el-button>
    </template>
    <template #topRightActions>
      <el-dropdown trigger="click" placement="bottom-end" :disabled="!outputFile || player?.capturing || uploading || exporting" @command="captureFrame($event)">
        <el-button :icon="IconPhotoScan" :loading="player?.capturing || videoLoading" :disabled="!outputFile || player?.capturing || uploading || exporting" text :title="videoLoading ? '视频加载中…' : '截取视频帧'" aria-label="截取视频帧" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="current" :icon="IconPhotoScan">截取当前帧</el-dropdown-item>
            <el-dropdown-item command="first" :icon="IconPlayerSkipBack">截取首帧</el-dropdown-item>
            <el-dropdown-item command="last" :icon="IconPlayerSkipForward">截取尾帧</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
    <div class="videoContent nopan">
      <div v-if="exporting" class="exportLoading" role="status" aria-label="视频导出中">
        <el-progress type="circle" :percentage="exportProgress" :width="64" :strokeWidth="3" />
        <span>正在导出视频</span>
      </div>
      <div v-else-if="posterUrl" class="videoPoster" role="button" tabindex="0" :aria-label="videoLoading ? '视频加载中' : '播放视频'" :aria-busy="videoLoading" @click.stop="startPlayback()" @keydown.enter.stop="startPlayback()">
        <img :src="posterUrl" alt="视频封面" />
        <span v-if="videoLoading" class="videoLoading" aria-hidden="true">加载中…</span>
        <span v-else class="videoPlay" aria-hidden="true">▶</span>
      </div>
      <videoPlayer
        v-else-if="previewUrl"
        ref="player"
        :src="previewUrl"
        @loadedmetadata="resizeVideo" />
      <input ref="fileInput" class="fileInput" type="file" accept="video/*" aria-label="选择视频" :disabled="uploading || exporting" @change="uploadVideo" />
      <el-button
        v-if="!exporting && !outputs.video"
        class="nodrag nopan"
        :icon="IconUpload"
        text
        :loading="uploading"
        title="上传视频"
        aria-label="上传视频"
        @dblclick.stop
        @click.stop="fileInput?.click()">上传</el-button>
    </div>
  </nodeSkeleton>
  <videoActions ref="actions" :file="outputFile" :src="previewUrl" :disabled="uploading || exporting" />
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from "vue";
import { IconVideo, IconUpload, IconTransfer, IconMusic, IconLayersSubtract, IconScissors, IconMovie, IconPhotoScan, IconPlayerSkipBack, IconPlayerSkipForward } from "@tabler/icons-vue";
import { ElButton, ElMessage, ElProgress, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import { nodeSkeleton, nodeTools, useNode, z, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import videoPlayer from "./components/videoPlayer.vue";
import videoActions from "./components/videoActions.vue";
import { getMediaMimeType } from "@toonflow/node-shared/mediaTypes";

defineOptions({
  inheritAttrs: false,
  icon: IconVideo,
  handles: [{ id: "video", type: "source", dataType: "VIDEO", label: "视频输出" }] satisfies NodeHandle[],
});
const { node, nodeProps, outputs, nodeEvent, files, updateNodeInternals } = useNode({
  label: "视频",
});
const fileInput = ref<HTMLInputElement>();
const uploading = ref(false);
const player = ref<InstanceType<typeof videoPlayer>>();
const actions = ref<InstanceType<typeof videoActions>>();
const exportProgress = computed(() => (node.data as typeof node.data & { exportProgress?: number }).exportProgress);
const exporting = computed(() => typeof exportProgress.value === "number");
const videoWidth = ref(0);

const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
// ACT: 先只取首帧封面，点击播放后才下载视频，避免打开画布就拉整段 mp4。
const playRequested = ref(false);
const posterUrl = files.useFileUrl(
  () => outputFile.value ? { url: outputFile.value.url, mimeType: "image/webp" } : undefined,
  () => {},
  { width: 960 },
);
const previewUrl = files.useFileUrl(
  () => playRequested.value ? outputFile.value : undefined,
  // ACT: 加载失败时立即结束等待中的操作，避免用户白等超时。
  (error) => { settleLoads(error); showError(error, "视频读取失败"); }
);
watch(() => outputFile.value?.url, () => {
  playRequested.value = false;
  settleLoads(new Error("视频已切换，请重新操作"));
});

// ACT: 视频按需加载 —— 点击播放/操作时才下载视频，加载完成后再执行动作。
const videoLoading = ref(false);
const loadWaiters = new Set<{ resolve: (url: string) => void; reject: (error: unknown) => void; timer: number }>();

function settleLoads(error?: unknown) {
  for (const waiter of loadWaiters) {
    window.clearTimeout(waiter.timer);
    if (error) waiter.reject(error);
  }
  loadWaiters.clear();
  if (error) videoLoading.value = false;
}

watch(previewUrl, value => {
  if (!value) return;
  videoLoading.value = false;
  for (const waiter of loadWaiters) {
    window.clearTimeout(waiter.timer);
    waiter.resolve(value);
  }
  loadWaiters.clear();
});

async function ensureVideo() {
  if (previewUrl.value) return previewUrl.value;
  if (!outputFile.value) throw new Error("节点还没有视频");
  if (playRequested.value) {
    // ACT: 上次加载失败或被打断时先复位，再重新触发，避免监听不生效而空等超时。
    playRequested.value = false;
    await nextTick();
  }
  playRequested.value = true;
  videoLoading.value = true;
  return await new Promise<string>((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: window.setTimeout(() => {
        loadWaiters.delete(waiter);
        videoLoading.value = false;
        reject(new Error("视频加载超时，请检查网络后重试"));
      }, 90_000),
    };
    loadWaiters.add(waiter);
  });
}

onScopeDispose(() => settleLoads(new Error("节点已关闭")));

function startPlayback() {
  if (videoLoading.value) return;
  ensureVideo().catch(error => showError(error, "视频加载失败"));
}

function waitPlayerReady() {
  if (player.value?.ready) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      stop();
      reject(new Error("播放器准备超时，请重试"));
    }, 30_000);
    const stop = watch(() => player.value?.ready, ready => {
      if (!ready) return;
      window.clearTimeout(timer);
      stop();
      resolve();
    });
  });
}

async function openAction(name: "extractAudio" | "separate" | "trim") {
  if (!outputFile.value || uploading.value || exporting.value) return;
  // ACT: 提取音轨/分离音视频由 ffmpeg 直接处理工作区文件，无需先下载；截取片段需要视频预览，先按需加载。
  if (name !== "trim") return void actions.value?.open(name);
  try {
    await ensureVideo();
  } catch (error) {
    return showError(error, "视频加载失败");
  }
  actions.value?.open(name);
}

async function captureFrame(command: "current" | "first" | "last") {
  if (!outputFile.value || player.value?.capturing) return;
  try {
    await ensureVideo();
    await nextTick();
    await waitPlayerReady();
  } catch (error) {
    return showError(error, "视频加载失败");
  }
  player.value?.captureFrame(command);
}

async function enterFullscreen() {
  if (!outputFile.value) return;
  try {
    await ensureVideo();
    await nextTick();
    await waitPlayerReady();
  } catch (error) {
    return showError(error, "视频加载失败");
  }
  player.value?.enterFullscreen();
}

async function downloadVideo() {
  if (!outputFile.value) return;
  let url = "";
  try {
    url = await ensureVideo();
  } catch (error) {
    return showError(error, "视频加载失败");
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = outputFile.value?.url.split(/[\\/]/).at(-1) || "video.mp4";
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

nodeEvent.on("save", (reason) => {
  if (uploading.value) throw new Error("视频处理中，请完成后再切换或刷新节点");
  if (reason === "reload" && exporting.value) throw new Error("视频正在导出，请完成后再刷新节点");
});
nodeEvent.on("delete", () => {
  if (uploading.value) throw new Error("视频上传中，请稍后删除节点");
  uploading.value = true;
  return files.removeNodeFiles().finally(() => {
    uploading.value = false;
  });
});

nodeTools.register({
  name: "setVideo",
  description: "选择工作区内已有的视频文件作为此节点的输出，path 使用工作区相对路径",
  parameters: z.strictObject({
    path: z.string().min(1).max(4096),
    mimeType: z.string().regex(/^video\/[a-zA-Z0-9.+-]+$/),
  }),
  async execute({ path, mimeType }, { signal }) {
    signal?.throwIfAborted();
    if (uploading.value || exporting.value) throw new Error("视频处理中，请稍后重试");
    uploading.value = true;
    try {
      const content = await files.getWorkspaceFiles().read(path);
      signal?.throwIfAborted();
      if (!content.byteLength || content.byteLength > 100 * 1024 * 1024) throw new Error("视频不能为空且不能超过 100 MB");
      outputs.value.video = { dataType: "VIDEO", value: { url: path, mimeType } };
      return outputs.value.video;
    } finally {
      uploading.value = false;
    }
  },
});

async function resizeVideo(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!video.videoWidth || !video.videoHeight) return;
  videoWidth.value = Math.max(180, (240 * video.videoWidth) / video.videoHeight);
  await nextTick();
  updateNodeInternals();
}

async function uploadVideo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || uploading.value || exporting.value) return;
  const mimeType = getMediaMimeType(file);
  if (!mimeType.startsWith("video/")) return void ElMessage.error("请选择视频文件");
  if (!file.size || file.size > 100 * 1024 * 1024) return void ElMessage.error("视频不能为空且不能超过 100 MB");
  uploading.value = true;
  try {
    const url = await files.uploadFile(file);
    // ACT: 复制节点可能仍引用旧视频，替换输出不删除共享文件。
    outputs.value.video = { dataType: "VIDEO", value: { url, mimeType } };
  } catch (error) {
    showError(error, "视频替换失败");
  } finally {
    uploading.value = false;
  }
}

function showError(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  ElMessage.error(message || (error instanceof Error ? error.message : fallback));
}
</script>

<style scoped lang="scss">
.videoPoster {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  border-radius: 8px;

  img {
    display: block;
    width: 100%;
    height: auto;
  }

  .videoLoading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 12px;
    letter-spacing: 1px;
    background: rgba(0, 0, 0, 0.42);
  }

  .videoPlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 26px;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
    background: rgba(0, 0, 0, 0.14);
    transition: background 0.15s;

    &:hover {
      background: rgba(0, 0, 0, 0.26);
    }
  }
}

.videoContent {
  .nodeSkeleton.resized & {
    height: 100%;
    min-height: 0;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    --nodeMediaHeight: 100%;

    .exportLoading { max-height: 100%; box-sizing: border-box; overflow: auto; }
  }

  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .exportLoading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px;
    color: var(--el-text-color-secondary);
  }

  .fileInput {
    display: none;
  }
}
</style>
