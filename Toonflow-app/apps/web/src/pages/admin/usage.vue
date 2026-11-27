<template>
  <div class="usagePage">
    <section class="toolbar">
      <div class="rangeGroup">
        <button v-for="option in rangeOptions" :key="option.value" class="rangeButton" :class="{ active: days === option.value }" type="button" @click="changeRange(option.value)">
          {{ option.label }}
        </button>
      </div>
      <span class="rangeHint">统计生成接口的提交次数，异步任务以画布内状态为准</span>
    </section>

    <section class="statRow">
      <article v-for="card in cards" :key="card.label" class="statCard">
        <span class="statLabel">{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <span class="statSub">{{ card.sub }}</span>
      </article>
    </section>

    <section class="panel">
      <header class="panelHeader">
        <div>
          <h3>生成趋势</h3>
          <p>{{ rangeLabel }}内按媒体类型拆分</p>
        </div>
        <div class="legend">
          <span v-for="item in legend" :key="item.label"><i :style="{ background: item.color }" />{{ item.label }}</span>
        </div>
      </header>
      <div v-loading="loading" class="chartArea">
        <div class="chartGrid"><span v-for="line in 4" :key="line" class="gridLine" /></div>
        <div class="chartBars">
          <div v-for="day in data?.days ?? []" :key="day.date" class="chartCol" :title="`${day.date}：${day.total} 次，失败 ${day.failed} 次`">
            <span class="barTotal">{{ day.total || "" }}</span>
            <div class="barTrack">
              <div class="barStack" :style="{ height: `${barHeight(day.total)}%` }">
                <i v-if="day.text" class="seg text" :style="{ flexGrow: day.text }" />
                <i v-if="day.audio" class="seg audio" :style="{ flexGrow: day.audio }" />
                <i v-if="day.video" class="seg video" :style="{ flexGrow: day.video }" />
                <i v-if="day.image" class="seg image" :style="{ flexGrow: day.image }" />
              </div>
            </div>
            <span class="barLabel">{{ day.date.slice(5) }}</span>
          </div>
        </div>
        <p v-if="!loading && !hasData" class="chartEmpty">当前时间范围内没有生成记录</p>
      </div>
    </section>

    <section class="panelRow">
      <article class="panel">
        <header class="panelHeader">
          <div>
            <h3>模型使用</h3>
            <p>调用次数最多的模型</p>
          </div>
        </header>
        <el-table :data="data?.models ?? []" size="small" :empty-text="loading ? '加载中…' : '暂无数据'">
          <el-table-column label="模型" min-width="180">
            <template #default="{ row }">
              <div class="modelCell">
                <span class="kindDot" :class="row.kind" />
                <div>
                  <strong>{{ row.model }}</strong>
                  <span>{{ kindLabels[row.kind] ?? row.kind }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="调用" width="80" align="right">
            <template #default="{ row }">{{ row.count }}</template>
          </el-table-column>
          <el-table-column label="失败" width="80" align="right">
            <template #default="{ row }"><span :class="{ failed: row.failed > 0 }">{{ row.failed }}</span></template>
          </el-table-column>
          <el-table-column label="平均耗时" width="100" align="right">
            <template #default="{ row }">{{ Math.round(row.totalMs / Math.max(1, row.count) / 1000) }}s</template>
          </el-table-column>
        </el-table>
      </article>

      <article class="panel">
        <header class="panelHeader">
          <div>
            <h3>成员用量</h3>
            <p>按账号聚合的生成次数</p>
          </div>
        </header>
        <el-table :data="data?.users ?? []" size="small" :empty-text="loading ? '加载中…' : '暂无数据'">
          <el-table-column label="成员" min-width="140">
            <template #default="{ row }">
              <div class="memberCell">
                <span class="avatar">{{ row.username.slice(0, 1).toUpperCase() }}</span>
                <span>{{ row.username }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="次数" width="80" align="right">
            <template #default="{ row }">{{ row.count }}</template>
          </el-table-column>
          <el-table-column label="失败" width="80" align="right">
            <template #default="{ row }"><span :class="{ failed: row.failed > 0 }">{{ row.failed }}</span></template>
          </el-table-column>
        </el-table>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type UsageData } from "@/lib/admin";

const days = ref(7);
const data = ref<UsageData | null>(null);
const loading = ref(true);
const rangeOptions = [{ label: "近 7 天", value: 7 }, { label: "近 30 天", value: 30 }, { label: "近 90 天", value: 90 }];
const kindLabels: Record<string, string> = { image: "图片", video: "视频", audio: "音频", text: "文本" };
const legend = [
  { label: "图片", color: "#8f6bff" },
  { label: "视频", color: "#3fbfb4" },
  { label: "音频", color: "#e0a24a" },
  { label: "文本", color: "#7d8da6" },
];

const rangeLabel = computed(() => rangeOptions.find(option => option.value === days.value)?.label ?? "");
const hasData = computed(() => (data.value?.days ?? []).some(day => day.total > 0));
const maxTotal = computed(() => Math.max(1, ...(data.value?.days ?? []).map(day => day.total)));
const barHeight = (total: number) => total <= 0 ? 2 : Math.max(8, Math.round((total / maxTotal.value) * 100));

const totals = computed(() => {
  const list = data.value?.days ?? [];
  const sum = list.reduce((accumulator, day) => ({
    image: accumulator.image + day.image,
    video: accumulator.video + day.video,
    audio: accumulator.audio + day.audio,
    text: accumulator.text + day.text,
    failed: accumulator.failed + day.failed,
  }), { image: 0, video: 0, audio: 0, text: 0, failed: 0 });
  return { ...sum, total: list.reduce((value, day) => value + day.total, 0) };
});

const cards = computed(() => {
  const total = data.value?.total ?? 0;
  const failed = totals.value.failed;
  return [
    { label: "总调用", value: String(total), sub: `${rangeLabel.value}累计` },
    { label: "请求成功率", value: total ? `${Math.round(((total - failed) / total) * 100)}%` : "—", sub: `请求失败 ${failed} 次` },
    { label: "视频生成", value: String(totals.value.video), sub: `图片 ${totals.value.image} 次` },
    { label: "音频与文本", value: String(totals.value.audio + totals.value.text), sub: `音频 ${totals.value.audio} · 文本 ${totals.value.text}` },
  ];
});

async function load() {
  loading.value = true;
  try {
    data.value = await adminApi.usage(days.value);
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "加载失败");
  } finally {
    loading.value = false;
  }
}

function changeRange(value: number) {
  if (days.value === value) return;
  days.value = value;
  void load();
}

onMounted(load);
</script>

<style scoped>
.usagePage { display: flex; flex-direction: column; gap: 16px; }
.toolbar { display: flex; align-items: center; gap: 14px; }
.rangeGroup { display: inline-flex; padding: 3px; border-radius: 9px; background: var(--el-fill-color-light); }
.rangeButton { height: 28px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; color: var(--el-text-color-secondary); font-size: 11.5px; cursor: pointer; }
.rangeButton.active { background: var(--el-bg-color); color: var(--el-text-color-primary); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08); font-weight: 500; }
.rangeHint { color: var(--el-text-color-placeholder); font-size: 11px; }
.statRow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.statCard { padding: 14px 16px; border: 1px solid var(--el-border-color-lighter); border-radius: 11px; background: var(--el-bg-color); }
.statLabel { display: block; margin-bottom: 5px; color: var(--el-text-color-placeholder); font-size: 11px; }
.statCard strong { display: block; font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -0.3px; }
.statSub { display: block; margin-top: 4px; color: var(--el-text-color-placeholder); font-size: 10.5px; }
.panel { padding: 18px 20px; border: 1px solid var(--el-border-color-lighter); border-radius: 12px; background: var(--el-bg-color); }
.panelHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.panelHeader h3 { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
.panelHeader p { margin: 0; color: var(--el-text-color-placeholder); font-size: 11px; }
.legend { display: flex; flex-wrap: wrap; gap: 10px; color: var(--el-text-color-secondary); font-size: 10.5px; }
.legend span { display: flex; align-items: center; gap: 5px; }
.legend i { width: 7px; height: 7px; border-radius: 2px; }
.chartArea { position: relative; height: 200px; }
.chartGrid { position: absolute; inset: 8px 0 24px; display: flex; flex-direction: column; justify-content: space-between; }
.gridLine { display: block; height: 1px; background: var(--el-border-color-extra-light); }
.chartBars { position: relative; display: flex; align-items: flex-end; justify-content: space-around; height: 100%; gap: 6px; padding: 0 4px; }
.chartCol { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 0; }
.barTotal { margin-bottom: 3px; color: var(--el-text-color-placeholder); font-size: 9.5px; font-variant-numeric: tabular-nums; }
.barTrack { display: flex; align-items: flex-end; justify-content: center; width: 100%; height: 100%; }
.barStack { display: flex; flex-direction: column-reverse; width: min(30px, 66%); min-height: 2px; border-radius: 4px 4px 2px 2px; overflow: hidden; transition: height 0.4s ease; }
.seg { display: block; width: 100%; }
.seg.image { background: linear-gradient(180deg, #a58cff, #8f6bff); }
.seg.video { background: linear-gradient(180deg, #5fd0c5, #3fbfb4); }
.seg.audio { background: linear-gradient(180deg, #edb96a, #e0a24a); }
.seg.text { background: linear-gradient(180deg, #94a3b8, #7d8da6); }
.barLabel { margin-top: 7px; color: var(--el-text-color-placeholder); font-size: 9.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.chartEmpty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--el-text-color-placeholder); font-size: 12px; }
.panelRow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.modelCell { display: flex; align-items: center; gap: 9px; }
.kindDot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 2px; background: #8f6bff; }
.kindDot.video { background: #3fbfb4; }
.kindDot.audio { background: #e0a24a; }
.kindDot.text { background: #7d8da6; }
.modelCell div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.modelCell strong { overflow: hidden; font-size: 11.5px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.modelCell span { color: var(--el-text-color-placeholder); font-size: 10px; }
.memberCell { display: flex; align-items: center; gap: 8px; }
.avatar { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(140deg, #5a37e0, #8f6bff); color: #fff; font-size: 10px; font-weight: 600; }
.failed { color: var(--el-color-danger); }
@media (max-width: 1000px) { .statRow { grid-template-columns: repeat(2, minmax(0, 1fr)); } .panelRow { grid-template-columns: 1fr; } }
</style>
