<template>
  <el-dialog v-model="visible" title="拉片报告" width="min(1040px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose>
    <div class="analysisReport nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <div class="reportToolbar">
        <div class="reportFacts">
          <span class="shotCount"><icon-movie :size="16" />{{ result.scenes.length }} 个镜头</span>
          <span><icon-clock :size="15" />{{ formatSceneTime(result.duration) }}</span>
          <span>{{ result.width }} × {{ result.height }}</span>
          <span v-if="result.audio"><icon-wave-sine :size="15" />原音轨</span>
        </div>
        <div class="reportExport">
          <el-button :icon="IconFileText" text size="small" aria-label="导出拉片报告 Markdown" @click="exportReport('md')">导出报告</el-button>
          <el-button :icon="IconFileSpreadsheet" text size="small" aria-label="导出镜头表格 CSV" @click="exportReport('csv')">导出表格</el-button>
        </div>
        <el-button v-if="manifestUrl" class="downloadButton" tag="a" :href="manifestUrl" download="sceneManifest.json" :icon="IconDownload" text size="small">下载清单</el-button>
      </div>
      <div class="paceStats" aria-label="节奏统计">
        <div class="paceChips">
          <span class="paceChip"><small>镜头</small><b>{{ shotStats.count }}</b></span>
          <span class="paceChip"><small>平均</small><b>{{ shotStats.avg.toFixed(2) }}s</b></span>
          <span class="paceChip"><small>最长</small><b>{{ shotStats.max.toFixed(2) }}s</b></span>
          <span class="paceChip"><small>最短</small><b>{{ shotStats.min.toFixed(2) }}s</b></span>
          <span class="paceChip"><small>节奏</small><b>{{ shotStats.pace }}</b></span>
        </div>
        <div class="paceBars">
          <div v-for="bucket in shotStats.buckets" :key="bucket.label" class="paceRow">
            <span class="paceLabel">{{ bucket.label }}</span>
            <div class="paceTrack"><div class="paceFill" :style="{ width: `${bucket.percent}%` }" /></div>
            <span class="paceCount">{{ bucket.count }}</span>
          </div>
        </div>
      </div>
      <el-alert v-if="manifestError" :title="manifestError" type="error" :closable="false" showIcon />
      <el-alert v-if="result.ai?.overviewError" :title="`整段归纳未完成：${result.ai.overviewError}`" type="warning" :closable="false" showIcon />
      <el-tabs v-model="activeTab" class="reportTabs" :class="{ singleView: !result.overview }">
        <el-tab-pane label="镜头明细" name="scenes">
          <div class="sceneLayout">
            <el-scrollbar class="sceneNavigation" height="var(--sceneListHeight, min(56vh, 540px))">
              <nav class="sceneList" aria-label="镜头列表">
                <small v-if="result.userOrder" class="orderHint">已自定义排序（镜头编号保持不变）<el-button text size="small" @click="resetOrder">恢复检测顺序</el-button></small>
                <div v-for="(scene, order) in orderedScenes" :key="scene.index" class="sceneItemWrap">
                  <button
                    class="sceneItem"
                    :class="{ selected: selectedScene?.index === scene.index }"
                    type="button"
                    :aria-pressed="selectedScene?.index === scene.index"
                    :aria-label="`查看镜头 S${String(scene.index).padStart(2, '0')}`"
                    @click="selectedIndex = scene.index">
                    <span class="sceneItemHeading"><span class="sceneNumber">{{ order + 1 }}<small class="originNumber">S{{ String(scene.index).padStart(2, '0') }}</small></span><span class="sceneDuration">{{ (scene.end - scene.start).toFixed(2) }} 秒</span></span>
                    <span class="sceneRange">{{ formatSceneTime(scene.start) }} – {{ formatSceneTime(scene.end) }}</span>
                    <span v-if="scene.userNote" class="sceneCaption">📝 {{ scene.userNote }}</span><span v-else-if="scene.annotation" class="sceneCaption">{{ scene.annotation.description }}</span>
                  </button>
                  <span class="sceneOrder">
                    <el-button text size="small" :icon="IconArrowUp" :disabled="order === 0" aria-label="上移" @click.stop="moveScene(scene.index, -1)" />
                    <el-button text size="small" :icon="IconArrowDown" :disabled="order === orderedScenes.length - 1" aria-label="下移" @click.stop="moveScene(scene.index, 1)" />
                  </span>
                </div>
              </nav>
            </el-scrollbar>
            <el-scrollbar ref="detailScroll" class="sceneDetailScroll" height="var(--sceneDetailHeight, min(56vh, 540px))">
              <div v-if="selectedScene" class="sceneDetail" :class="{ hasAnnotation: !!selectedScene.annotation }">
                <div class="sceneHeading">
                  <div class="sceneTitle">
                    <h3>镜头 S{{ String(selectedScene.index).padStart(2, '0') }}</h3>
                    <span>{{ formatSceneTime(selectedScene.start) }} – {{ formatSceneTime(selectedScene.end) }}</span>
                  </div>
                  <el-radio-group v-if="selectedScene.image && selectedScene.video" v-model="previewKind" size="small" aria-label="镜头预览类型">
                    <el-radio-button value="image">关键帧</el-radio-button>
                    <el-radio-button value="video">视频片段</el-radio-button>
                  </el-radio-group>
                </div>
                <div v-if="previewFile" class="previewStage">
                  <p v-if="previewError" class="previewMessage" role="alert">{{ previewError }}</p>
                  <img v-else-if="previewUrl && previewFile.mimeType === 'image/jpeg'" :key="previewUrl" :src="previewUrl" :alt="`镜头 S${String(selectedScene.index).padStart(2, '0')} 关键帧`" @error="previewError = '关键帧无法预览，文件可能已被移动或删除'" />
                  <video v-else-if="previewUrl" ref="previewVideo" :key="previewUrl" :src="previewUrl" controls playsinline preload="metadata" :aria-label="`镜头 S${String(selectedScene.index).padStart(2, '0')} 视频片段`" @error="previewError = '视频片段无法预览，文件可能已被移动或删除'" />
                  <p v-else class="previewMessage" role="status">正在读取画面…</p>
                </div>
                <div v-if="selectedScene.annotation" class="sceneAnnotation">
                  <div class="annotationFacts">
                    <span>{{ selectedScene.annotation.shotSize }}</span>
                    <span>{{ selectedScene.annotation.cameraAngle }}</span>
                  </div>
                  <p class="sceneDescription">{{ selectedScene.annotation.description }}</p>
                  <div class="movementDetail"><span class="detailLabel">镜头运动</span><p>{{ selectedScene.annotation.movement }}</p></div>
                </div>
                <div class="sceneUserNote">
                  <div class="noteHeader"><span><icon-edit :size="14" /> 我的批注</span><small>自动保存</small></div>
                  <el-input v-if="selectedScene" v-model="selectedScene.userNote" type="textarea" :rows="3" maxlength="2000" placeholder="记录这一镜头的观察、情绪、剪辑意图…" @keydown.stop />
                  <el-button v-if="selectedScene?.image" text size="small" :icon="IconPlus" @click="emit('createFrame', selectedScene)">关键帧生成图片节点</el-button>
                </div>
              </div>
            </el-scrollbar>
          </div>
        </el-tab-pane>
        <el-tab-pane label="镜头对比" name="compare">
          <div class="compareLayout">
            <div class="compareSelectors">
              <el-select v-model="compareIndices[0]" size="small" aria-label="对比镜头 1"><el-option v-for="scene in orderedScenes" :key="scene.index" :value="scene.index" :label="`S${String(scene.index).padStart(2, '0')} · ${(scene.end - scene.start).toFixed(2)} 秒`" /></el-select>
              <span class="compareVs">对比</span>
              <el-select v-for="(index, slot) in compareIndices.slice(1)" :key="slot" v-model="compareIndices[slot + 1]" size="small" :aria-label="`对比镜头 ${slot + 2}`"><el-option v-for="scene in orderedScenes" :key="scene.index" :value="scene.index" :label="`S${String(scene.index).padStart(2, '0')} · ${(scene.end - scene.start).toFixed(2)} 秒`" /></el-select>
              <el-button text size="small" :icon="IconPlus" :disabled="compareIndices.length >= 4" aria-label="添加对比镜头" @click="compareIndices = [...compareIndices, orderedScenes.find(scene => !compareIndices.includes(scene.index))?.index ?? 0]" />
            </div>
            <div class="compareGrid" :style="{ gridTemplateColumns: `repeat(${compareIndices.length}, 1fr)` }">
              <div v-for="side in compareSides" :key="side.index" class="compareCell">
                <div class="compareHeading"><span>镜头 S{{ String(side.index).padStart(2, '0') }}</span><span>{{ formatSceneTime(side.start) }}–{{ formatSceneTime(side.end) }} · {{ (side.end - side.start).toFixed(2) }} 秒</span></div>
                <img v-if="side.image && previews[side.image]" :src="previews[side.image]" alt="" />
                <p v-else class="previewMessage" role="status">正在读取画面…</p>
                <p class="compareNote" v-if="side.annotation">{{ side.annotation.shotSize }} · {{ side.annotation.cameraAngle }} · {{ side.annotation.movement }}</p>
                <p class="compareNote user" v-if="side.userNote">📝 {{ side.userNote }}</p>
              </div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane v-if="result.overview" label="整段分析" name="overview">
          <el-scrollbar height="min(56vh, 540px)">
            <div class="overviewBody">
              <section class="overviewLead">
                <h3><icon-sparkles :size="17" />整体概述</h3>
                <p>{{ result.overview.summary }}</p>
              </section>
              <section class="overviewSection"><h3>叙事结构</h3><p>{{ result.overview.narrative }}</p></section>
              <section class="overviewSection"><h3>节奏分析</h3><p>{{ result.overview.rhythm }}</p></section>
              <section class="overviewSection"><h3>剪辑方式</h3><p>{{ result.overview.editing }}</p></section>
              <section v-if="result.overview.focusResponse" class="overviewSection">
                <h3>分析重点</h3>
                <div><p v-if="result.ai?.focus" class="focusQuestion">{{ result.ai.focus }}</p><p>{{ result.overview.focusResponse }}</p></div>
              </section>
            </div>
          </el-scrollbar>
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElAlert, ElButton, ElDialog, ElInput, ElOption, ElRadioButton, ElRadioGroup, ElScrollbar, ElSelect, ElTabPane, ElTabs } from "element-plus";
import { IconClock, IconDownload, IconEdit, IconMovie, IconPlus, IconSparkles, IconWaveSine, IconFileText, IconFileSpreadsheet, IconArrowUp, IconArrowDown } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import type { AnalysisResult } from "./videoAnalysis";
import { formatSceneTime } from "./resultNodes";

const props = defineProps<{ result: AnalysisResult; createFrame?: (scene: import("./videoAnalysis").AnalysisScene) => void }>();
// ACT: 节奏统计与报告导出 —— 拉片工作流的标准交付物。
const shotStats = computed(() => {
  const durations = props.result.scenes.map(scene => scene.end - scene.start);
  const count = durations.length || 1;
  const avg = durations.reduce((sum, value) => sum + value, 0) / count;
  const pace = avg >= 6 ? "舒缓" : avg >= 3.5 ? "适中" : "紧凑";
  const edges = [0, 1, 2, 4, 8, Infinity];
  const labels = ["0–1s", "1–2s", "2–4s", "4–8s", "8s+"];
  const buckets = labels.map((label, index) => {
    const hits = durations.filter(value => value >= edges[index]! && value < edges[index + 1]!).length;
    return { label, count: hits, percent: Math.round(hits / count * 100) };
  });
  return { count: durations.length, avg, max: Math.max(...durations, 0), min: Math.min(...durations, 0), pace, buckets };
});

function formatSeconds(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${String(Math.floor(seconds * 100) % 100).padStart(2, "0")}`;
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

function exportReport(format: "md" | "csv") {
  const stamp = formatSeconds(props.result.duration).replace(/[.:]/g, "");
  const rows = orderedScenes.value.map(scene => ({
    index: `S${String(scene.index).padStart(2, "0")}`,
    start: formatSeconds(scene.start),
    end: formatSeconds(scene.end),
    duration: (scene.end - scene.start).toFixed(2),
    shotSize: scene.annotation?.shotSize ?? "",
    cameraAngle: scene.annotation?.cameraAngle ?? "",
    movement: scene.annotation?.movement ?? "",
    description: scene.annotation?.description ?? "",
    userNote: scene.userNote ?? "",
  }));
  const overview = props.result.overview;
  if (format === "csv") {
    const head = ["镜头", "开始", "结束", "时长(秒)", "景别", "机位", "运镜", "描述", "手动批注"];
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const body = [head, ...rows.map(row => [row.index, row.start, row.end, row.duration, row.shotSize, row.cameraAngle, row.movement, row.description, row.userNote])];
    const csv = "\uFEFF" + body.map(row => row.map(escape).join(",")).join("\r\n");
    downloadText(`拉片表格-${stamp}.csv`, csv, "text/csv");
    return;
  }
  const lines = [
    "# 拉片报告",
    "",
    `- 时长：${formatSeconds(props.result.duration)}（${props.result.duration.toFixed(2)} 秒）`,
    `- 分辨率：${props.result.width} × ${props.result.height}`,
    `- 镜头数：${props.result.scenes.length}（平均 ${shotStats.value.avg.toFixed(2)} 秒，节奏 ${shotStats.value.pace}）`,
    `- 原音轨：${props.result.audio ? "保留" : "无"}`,
    "",
    "## 镜头明细",
    "",
    "| 镜头 | 开始 | 结束 | 时长(秒) | 景别 | 机位 | 运镜 | 描述 |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(row => `| ${row.index} | ${row.start} | ${row.end} | ${row.duration} | ${row.shotSize} | ${row.cameraAngle} | ${row.movement} | ${row.description.replaceAll("\n", " ")} |`),
    "",
  ];
  if (overview) {
    lines.push(
      "## 整段分析",
      "",
      `- **整体概述**：${overview.summary}`,
      `- **叙事结构**：${overview.narrative}`,
      `- **节奏分析**：${overview.rhythm}`,
      `- **剪辑方式**：${overview.editing}`,
    );
    if (overview.focusResponse) lines.push(`- **分析重点**：${props.result.ai?.focus ?? ""} → ${overview.focusResponse}`);
    lines.push("");
  }
  downloadText(`拉片报告-${stamp}.md`, lines.join("\n"), "text/markdown");
}
const emit = defineEmits<{ createFrame: [scene: import("./videoAnalysis").AnalysisScene] }>();
const visible = defineModel<boolean>({ required: true });
const files = useNodeFiles();
// ACT: 用户排序 —— 只改变查看与导出顺序，镜头编号保持稳定（不影响结果节点映射）。
const orderedScenes = computed(() => {
  const scenes = props.result.scenes;
  const order = props.result.userOrder?.filter(index => scenes.some(scene => scene.index === index));
  if (!order?.length) return scenes;
  const rest = scenes.filter(scene => !order.includes(scene.index));
  return [...order.map(index => scenes.find(scene => scene.index === index)!), ...rest];
});
function moveScene(index: number, delta: number) {
  const order = orderedScenes.value.map(scene => scene.index);
  const at = order.indexOf(index);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= order.length) return;
  order.splice(to, 0, order.splice(at, 1)[0]!);
  props.result.userOrder = order;
}
function resetOrder() {
  props.result.userOrder = undefined;
}
// ACT: 镜头对比 —— 任意两镜头关键帧并排查看。
const compareIndices = ref<number[]>([0, 1]);
watch(() => props.result.scenes.length, length => {
  compareIndices.value = compareIndices.value.map(index => Math.min(index, Math.max(0, length - 1)));
}, { immediate: true });
const compareSides = computed(() => compareIndices.value.map(index => props.result.scenes.find(scene => scene.index === index) ?? props.result.scenes[0]));
const previews = ref<Record<string, string>>({});
watch([compareSides, () => props.result.scenes], async ([sides]) => {
  for (const scene of sides) {
    const path = scene.image;
    if (!path || previews.value[path]) continue;
    try {
      const url = await files.acquireUrl?.(path, "image/jpeg")?.url ?? URL.createObjectURL(new Blob([await files.read(path)], { type: "image/jpeg" }));
      previews.value = { ...previews.value, [path]: url };
    } catch { previews.value = { ...previews.value, [path]: "" }; }
  }
}, { immediate: true, deep: true });
const activeTab = ref("scenes");
const selectedIndex = ref(0);
const previewKind = ref("image");
const previewVideo = ref<HTMLVideoElement>();
const detailScroll = ref<InstanceType<typeof ElScrollbar>>();
const selectedScene = computed(() => props.result.scenes.find(scene => scene.index === selectedIndex.value) ?? props.result.scenes[0]);
const previewFile = computed<NodeMediaValue | undefined>(() => {
  const scene = selectedScene.value;
  if (!visible.value || activeTab.value !== "scenes" || !scene) return;
  if (scene.video && (previewKind.value === "video" || !scene.image)) return { url: scene.video, mimeType: "video/mp4" };
  if (scene.image) return { url: scene.image, mimeType: "image/jpeg" };
});
const previewError = ref("");
const manifestError = ref("");
watch(previewFile, () => {
  previewVideo.value?.pause();
  previewError.value = "";
}, { flush: "sync" });
onBeforeUnmount(() => previewVideo.value?.pause());
// ACT: 仅加载当前选中的画面，切换镜头或关闭报告时由宿主释放文件 URL。
const previewUrl = files.useFileUrl(previewFile, () => { previewError.value = "画面读取失败，文件可能已被移动或删除"; });
const manifestUrl = files.useFileUrl(
  computed(() => visible.value ? { url: props.result.manifest, mimeType: "application/json" } : undefined),
  () => { manifestError.value = "拉片清单读取失败，文件可能已被移动或删除"; },
);
watch(selectedScene, scene => {
  if (scene && !(previewKind.value === "image" ? scene.image : scene.video)) previewKind.value = scene.image ? "image" : "video";
  detailScroll.value?.setScrollTop(0);
});
watch(visible, open => {
  if (!open) return;
  selectedIndex.value = props.result.scenes[0]?.index ?? 0;
  previewKind.value = "image";
  activeTab.value = props.result.overview ? "overview" : "scenes";
  manifestError.value = "";
});
watch(() => props.result.overview, overview => {
  if (!overview && activeTab.value === "overview") activeTab.value = "scenes";
});
</script>

<style scoped lang="scss">
.analysisReport {
  color: var(--el-text-color-regular);

  .reportToolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px 16px;
    margin: 0 0 12px;

    .reportFacts {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 18px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      font-variant-numeric: tabular-nums;

      span { display: inline-flex; align-items: center; gap: 6px; }
      .shotCount { color: var(--el-text-color-primary); font-weight: 500; }
    }

    .downloadButton { margin: 0; text-decoration: none; }
  }

  > .el-alert { margin-bottom: 12px; }

  .reportTabs {
    :deep(.el-tabs__header) { margin-bottom: 16px; }
    :deep(.el-tabs__nav-wrap::after) { height: 1px; background: var(--el-border-color-lighter); }
    &.singleView :deep(.el-tabs__header) { display: none; }
  }

  .sceneLayout {
    display: grid;
    grid-template-columns: 214px minmax(0, 1fr);
    gap: 20px;

    .sceneNavigation {
      border-right: 1px solid var(--el-border-color-lighter);

      .sceneList {
        display: grid;
        align-content: start;
        gap: 6px;
        padding-right: 12px;

        .sceneItem {
          min-width: 0;
          padding: 12px 10px;
          border: 1px solid transparent;
          border-radius: var(--el-border-radius-base);
          background: transparent;
          color: var(--el-text-color-primary);
          font: inherit;
          text-align: left;
          cursor: pointer;

          &:hover { background: var(--el-fill-color-light); }
          &.selected { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
          &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }

          .sceneItemHeading {
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
            .sceneNumber { font-size: 13px; font-weight: 600; }
            .sceneDuration { font-size: 12px; color: var(--el-text-color-secondary); }
          }
          .sceneRange { display: block; margin-top: 6px; font-size: 11px; color: var(--el-text-color-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
          .sceneCaption { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 8px; font-size: 12px; color: var(--el-text-color-regular); }
        }
      }
    }

    .sceneDetailScroll { min-width: 0; }

    .sceneDetail {
      padding: 0 12px 4px 0;

      .sceneHeading {
        display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 2px 0 16px;
        .sceneTitle {
          h3 { margin: 0 0 6px; font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); }
          > span { color: var(--el-text-color-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
        }
      }

      .previewStage {
        display: flex;
        align-items: center;
        justify-content: center;
        height: min(460px, calc(56vh - 72px));
        min-height: 160px;
        overflow: hidden;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: var(--ui-radius-large, 12px);
        background: var(--el-fill-color-light);

        img, video { display: block; width: 100%; height: 100%; object-fit: contain; }
        .previewMessage { margin: 0; padding: 24px; text-align: center; color: var(--el-text-color-secondary); font-size: 13px; }
      }

      &.hasAnnotation .previewStage { height: clamp(180px, 34vh, 340px); }

      .sceneAnnotation {
        margin-top: 20px;
        overflow-wrap: anywhere;

        .annotationFacts {
          display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;
          span { padding: 4px 8px; border-radius: var(--el-border-radius-small); background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 12px; }
        }
        p { margin: 0; font-size: 14px; line-height: 1.8; white-space: pre-wrap; }
        .movementDetail {
          display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: baseline; gap: 12px;
          margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--el-border-color-lighter);
          .detailLabel { font-size: 12px; color: var(--el-text-color-secondary); }
        }
      }
    }
  }

  .overviewBody {
    padding: 2px 16px 8px 0;
    overflow-wrap: anywhere;

    h3 { margin: 0; color: var(--el-text-color-primary); font-size: 14px; font-weight: 600; }
    p { margin: 0; font-size: 14px; line-height: 1.9; white-space: pre-wrap; }
    .overviewLead {
      padding: 0 0 24px;
      h3 { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    }
    .overviewSection {
      display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 20px;
      padding: 22px 0; border-top: 1px solid var(--el-border-color-lighter);
      h3 { padding-top: 4px; }
      .focusQuestion { margin-bottom: 12px; padding-left: 12px; border-left: 2px solid var(--el-border-color); color: var(--el-text-color-secondary); }
    }
  }

  @media (max-width: 640px) {
    .sceneLayout {
      grid-template-columns: 144px minmax(0, 1fr);
      gap: 12px;
      .sceneNavigation .sceneList {
        padding-right: 8px;
        .sceneItem { padding: 10px 8px; .sceneRange { white-space: normal; line-height: 1.6; } }
      }
      .sceneDetail { padding-right: 8px; .sceneHeading { margin-top: 0; } }
    }
    .overviewBody .overviewSection { grid-template-columns: 1fr; gap: 10px; }
  }

  @media (max-width: 520px) {
    --sceneListHeight: 112px;
    --sceneDetailHeight: min(44vh, 380px);

    .sceneLayout {
      grid-template-columns: minmax(0, 1fr);
      .sceneNavigation {
        border-right: 0;
        border-bottom: 1px solid var(--el-border-color-lighter);
        .sceneList { grid-template-columns: repeat(auto-fit, minmax(136px, 1fr)); padding: 0 8px 10px 0; }
      }
      .sceneDetail .previewStage { height: min(300px, calc(44vh - 72px)); }
    }
  }
}

.reportExport { display: flex; gap: 2px; }
.paceStats {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-light);
  margin-bottom: 12px;

  .paceChips { display: flex; gap: 8px; flex-wrap: wrap; }
  .paceChip {
    display: flex; flex-direction: column; align-items: center; min-width: 52px;
    padding: 4px 10px; border-radius: 8px; background: var(--el-fill-color);
    small { color: var(--el-text-color-secondary); font-size: 11px; }
    b { font-size: 13px; font-variant-numeric: tabular-nums; }
  }
  .paceBars { flex: 1; min-width: 260px; display: grid; gap: 4px;
    .paceRow { display: flex; align-items: center; gap: 8px;
      .paceLabel { width: 44px; color: var(--el-text-color-secondary); font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }
      .paceTrack { flex: 1; height: 8px; border-radius: 4px; background: var(--el-fill-color-darker); overflow: hidden; }
      .paceFill { height: 100%; border-radius: 4px; background: var(--el-color-primary-light-5); }
      .paceCount { width: 24px; color: var(--el-text-color-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
    }
  }
}

.sceneUserNote {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter);

  .noteHeader { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;
    span { display: flex; align-items: center; gap: 4px; color: var(--el-text-color-regular); font-size: 13px; font-weight: 500; }
    small { color: var(--el-text-color-placeholder); font-size: 11px; }
  }
}
.compareLayout {
  .compareSelectors { display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
    .el-select { flex: 1; }
    .compareVs { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 600; }
  }
  .compareGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
    .compareCell { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 10px; background: var(--el-fill-color-light);
      .compareHeading { display: flex; justify-content: space-between; margin-bottom: 8px; color: var(--el-text-color-regular); font-size: 13px; font-weight: 500;
        span:last-child { color: var(--el-text-color-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
      }
      img { display: block; width: 100%; border-radius: 8px; }
      .compareNote { margin: 8px 0 0; color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; }
      .compareNote.user { color: var(--el-text-color-regular); }
    }
  }
}

.orderHint { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 4px 6px; color: var(--el-text-color-secondary); font-size: 11px; }
.sceneItemWrap { display: flex; align-items: stretch; gap: 2px; margin-bottom: 4px;
  .sceneItem { flex: 1; min-width: 0; }
  .sceneOrder { display: flex; flex-direction: column; justify-content: center; }
}
.sceneItemHeading .sceneNumber { display: inline-flex; align-items: baseline; gap: 4px;
  .originNumber { color: var(--el-text-color-placeholder); font-size: 10px; font-weight: 400; }
}
</style>
