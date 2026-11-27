<template>
  <div class="dashboard">
    <section class="heroRow">
      <div>
        <p class="eyebrow">{{ greeting }}，{{ authState.user?.displayName }}</p>
        <h2 class="heroTitle">这是团队今天的创作现场</h2>
        <p class="heroLead">账号、项目与生成任务的关键指标都会汇总在这里，异常情况会第一时间出现在操作日志中。</p>
      </div>
      <button class="primaryButton" type="button" @click="router.push('/admin/users')">
        <icon-user-plus :size="15" aria-hidden="true" />
        邀请成员
      </button>
    </section>

    <section class="metricGrid">
      <article v-for="card in metrics" :key="card.label" class="metricCard">
        <div class="metricTop">
          <span class="metricIcon" :style="{ background: card.tint, color: card.color }">
            <component :is="card.icon" :size="17" aria-hidden="true" />
          </span>
          <span class="metricHint">{{ card.hint }}</span>
        </div>
        <strong class="metricValue">{{ card.value }}</strong>
        <span class="metricLabel">{{ card.label }}</span>
        <div class="metricFoot">
          <span class="metricSub">{{ card.sub }}</span>
          <span v-if="card.badge" class="metricBadge">{{ card.badge }}</span>
        </div>
      </article>
    </section>

    <section class="panelRow">
      <article class="panel chartPanel">
        <header class="panelHeader">
          <div>
            <h3>近 7 天生成量</h3>
            <p>按媒体类型拆分统计</p>
          </div>
          <div class="legend">
            <span v-for="item in legend" :key="item.label"><i :style="{ background: item.color }" />{{ item.label }}</span>
          </div>
        </header>
        <div v-if="loading" class="chartLoading"><span class="skeleton" /></div>
        <div v-else class="chartArea">
          <div class="chartGrid">
            <span v-for="line in 4" :key="line" class="gridLine" />
          </div>
          <div class="chartBars">
            <div v-for="day in trend" :key="day.date" class="chartCol" :title="`${day.date}：${day.total} 次`">
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
          <p v-if="!hasTrend" class="chartEmpty">还没有生成记录。成员开始创作后，这里会自动出现趋势。</p>
        </div>
      </article>

      <article class="panel activityPanel">
        <header class="panelHeader">
          <div>
            <h3>最近动态</h3>
            <p>登录、账号变更与项目操作</p>
          </div>
          <a class="textLink" href="#/admin/audit">查看全部</a>
        </header>
        <ul v-if="overview?.recent.length" class="activityList">
          <li v-for="item in overview.recent" :key="item.id">
            <span class="activityDot" :class="dotClass(item.action)" />
            <div class="activityCopy">
              <p><strong>{{ item.username || "系统" }}</strong> {{ actionLabels[item.action] ?? item.action }}</p>
              <span>{{ item.detail || (item.target_type ? `${item.target_type} · ${item.target_id ?? ""}` : "操作已完成") }} · {{ relativeTime(item.created_at) }}</span>
            </div>
          </li>
        </ul>
        <p v-else class="emptyText">暂无操作记录</p>
      </article>
    </section>

    <section class="panel">
      <header class="panelHeader">
        <div>
          <h3>活跃项目</h3>
          <p>按最近修改时间排序</p>
        </div>
        <a class="textLink" href="#/admin/projects">管理项目</a>
      </header>
      <div v-if="overview?.topProjects.length" class="projectGrid">
        <article v-for="project in overview.topProjects" :key="project.name" class="projectCard">
          <span class="projectIcon"><icon-folders :size="16" aria-hidden="true" /></span>
          <div class="projectCopy">
            <strong>{{ project.name }}</strong>
            <span>{{ project.canvasCount }} 个画布 · {{ project.assetCount }} 个素材</span>
          </div>
          <span class="projectMeta">{{ formatBytes(project.size) }}<br />{{ relativeTime(project.updatedAt) }}</span>
        </article>
      </div>
      <p v-else class="emptyText">还没有项目</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { IconChartBar, IconDatabase, IconFolders, IconUserPlus, IconUsers } from "@tabler/icons-vue";
import { authState } from "@/lib/auth";
import { actionLabels, adminApi, formatBytes, relativeTime, type OverviewData } from "@/lib/admin";

const router = useRouter();
const overview = ref<OverviewData | null>(null);
const loading = ref(true);

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
});

const trend = computed(() => overview.value?.usage.trend ?? []);
const hasTrend = computed(() => trend.value.some(day => day.total > 0));
const maxTotal = computed(() => Math.max(1, ...trend.value.map(day => day.total)));
const barHeight = (total: number) => total <= 0 ? 2 : Math.max(8, Math.round((total / maxTotal.value) * 100));

const legend = [
  { label: "图片", color: "#8f6bff" },
  { label: "视频", color: "#3fbfb4" },
  { label: "音频", color: "#e0a24a" },
  { label: "文本", color: "#7d8da6" },
];

const metrics = computed(() => {
  const data = overview.value;
  return [
    {
      label: "团队成员", value: data ? String(data.users.total) : "—", hint: "账号总数",
      sub: `${data?.users.active ?? 0} 个启用 · ${data?.users.admins ?? 0} 位管理员`,
      icon: IconUsers, tint: "rgba(143, 107, 255, 0.12)", color: "#8f6bff",
    },
    {
      label: "项目与画布", value: data ? String(data.projects.total) : "—", hint: "工作区",
      sub: `${data?.projects.canvases ?? 0} 个画布 · ${data?.projects.assets ?? 0} 个素材`,
      icon: IconFolders, tint: "rgba(63, 191, 180, 0.12)", color: "#2f9e94",
    },
    {
      label: "今日生成", value: data ? String(data.usage.today) : "—", hint: "近 24 小时",
      sub: `成功 ${data?.usage.todaySuccess ?? 0} 次`,
      badge: data && data.usage.today > 0 ? `${Math.round(((data.usage.todaySuccess ?? 0) / data.usage.today) * 100)}%` : "",
      icon: IconChartBar, tint: "rgba(224, 162, 74, 0.14)", color: "#c07c22",
    },
    {
      label: "存储占用", value: data ? formatBytes(data.storage.bytes) : "—", hint: "数据目录",
      sub: `${data?.storage.files ?? 0} 个文件`,
      icon: IconDatabase, tint: "rgba(125, 141, 166, 0.14)", color: "#5f7189",
    },
  ];
});

const dotClass = (action: string) => action.startsWith("login.failed") || action.includes("delete") ? "danger" : action.startsWith("login") ? "success" : "normal";

onMounted(async () => {
  try {
    overview.value = await adminApi.overview();
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.dashboard { display: flex; flex-direction: column; gap: 20px; }
.heroRow { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
.eyebrow { margin: 0 0 6px; color: var(--el-color-primary); font-size: 12px; font-weight: 600; letter-spacing: 0.4px; }
.heroTitle { margin: 0 0 8px; font-size: 24px; font-weight: 650; letter-spacing: -0.4px; }
.heroLead { max-width: 620px; margin: 0; color: var(--el-text-color-secondary); font-size: 12.5px; line-height: 1.7; }
.primaryButton {
  display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 14px; border: 0; border-radius: 8px;
  background: var(--el-color-primary); color: #fff; font-size: 12.5px; font-weight: 500; white-space: nowrap; cursor: pointer;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--el-color-primary) 32%, transparent);
}
.primaryButton:hover { filter: brightness(1.06); }

.metricGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.metricCard { padding: 16px 18px; border: 1px solid var(--el-border-color-lighter); border-radius: 12px; background: var(--el-bg-color); }
.metricTop { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.metricIcon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; }
.metricHint { color: var(--el-text-color-placeholder); font-size: 10.5px; letter-spacing: 0.5px; }
.metricValue { display: block; font-size: 26px; font-weight: 650; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; }
.metricLabel { display: block; margin-top: 2px; color: var(--el-text-color-regular); font-size: 12px; }
.metricFoot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--el-border-color-lighter); }
.metricSub { overflow: hidden; color: var(--el-text-color-placeholder); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
.metricBadge { padding: 1px 6px; border-radius: 20px; background: rgba(63, 191, 180, 0.12); color: #2f9e94; font-size: 10px; font-weight: 600; }

.panelRow { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 14px; }
.panel { padding: 18px 20px; border: 1px solid var(--el-border-color-lighter); border-radius: 12px; background: var(--el-bg-color); }
.panelHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.panelHeader h3 { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
.panelHeader p { margin: 0; color: var(--el-text-color-placeholder); font-size: 11px; }
.textLink { color: var(--el-color-primary); font-size: 11.5px; text-decoration: none; }
.textLink:hover { text-decoration: underline; }
.legend { display: flex; flex-wrap: wrap; gap: 10px; color: var(--el-text-color-secondary); font-size: 10.5px; }
.legend span { display: flex; align-items: center; gap: 5px; }
.legend i { width: 7px; height: 7px; border-radius: 2px; }

.chartArea { position: relative; height: 190px; }
.chartGrid { position: absolute; inset: 8px 0 24px; display: flex; flex-direction: column; justify-content: space-between; }
.gridLine { display: block; height: 1px; background: var(--el-border-color-extra-light); }
.chartBars { position: relative; display: flex; align-items: flex-end; justify-content: space-around; height: 100%; gap: 10px; }
.chartCol { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
.barTotal { margin-bottom: 4px; color: var(--el-text-color-placeholder); font-size: 10px; font-variant-numeric: tabular-nums; }
.barTrack { position: relative; display: flex; align-items: flex-end; justify-content: center; width: 100%; height: 100%; }
.barStack { display: flex; flex-direction: column-reverse; width: min(34px, 62%); min-height: 2px; border-radius: 5px 5px 2px 2px; overflow: hidden; transition: height 0.4s ease; }
.seg { display: block; width: 100%; }
.seg.image { background: linear-gradient(180deg, #a58cff, #8f6bff); }
.seg.video { background: linear-gradient(180deg, #5fd0c5, #3fbfb4); }
.seg.audio { background: linear-gradient(180deg, #edb96a, #e0a24a); }
.seg.text { background: linear-gradient(180deg, #94a3b8, #7d8da6); }
.barLabel { margin-top: 8px; color: var(--el-text-color-placeholder); font-size: 10px; font-variant-numeric: tabular-nums; }
.chartEmpty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--el-text-color-placeholder); font-size: 12px; }
.chartLoading { height: 190px; }
.skeleton { display: block; height: 100%; border-radius: 8px; background: linear-gradient(90deg, var(--el-fill-color-light) 25%, var(--el-fill-color-lighter) 37%, var(--el-fill-color-light) 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; }

.activityList { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 0; list-style: none; }
.activityList li { display: flex; gap: 10px; }
.activityDot { width: 7px; height: 7px; margin-top: 6px; flex-shrink: 0; border-radius: 50%; background: var(--el-color-primary); }
.activityDot.success { background: #3fbfb4; }
.activityDot.danger { background: #ef6b6b; }
.activityCopy p { margin: 0 0 2px; color: var(--el-text-color-regular); font-size: 12px; line-height: 1.5; }
.activityCopy p strong { color: var(--el-text-color-primary); font-weight: 600; }
.activityCopy span { color: var(--el-text-color-placeholder); font-size: 10.5px; }
.emptyText { margin: 0; padding: 24px 0; color: var(--el-text-color-placeholder); font-size: 12px; text-align: center; }

.projectGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.projectCard { display: flex; align-items: center; gap: 11px; padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 9px; }
.projectIcon { display: grid; place-items: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); }
.projectCopy { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 2px; }
.projectCopy strong { overflow: hidden; font-size: 12.5px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.projectCopy span { color: var(--el-text-color-placeholder); font-size: 10.5px; }
.projectMeta { color: var(--el-text-color-placeholder); font-size: 10px; line-height: 1.5; text-align: right; white-space: nowrap; }

@keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
@media (max-width: 1200px) { .metricGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .panelRow { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .heroRow { flex-direction: column; align-items: flex-start; } .metricGrid { grid-template-columns: 1fr; } }
</style>
