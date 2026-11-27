<template>
  <div class="projectsPage">
    <section class="statRow">
      <article class="statCard">
        <span class="statLabel">项目总数</span>
        <strong>{{ summary.total }}</strong>
      </article>
      <article class="statCard">
        <span class="statLabel">画布数量</span>
        <strong>{{ canvases }}</strong>
      </article>
      <article class="statCard">
        <span class="statLabel">素材文件</span>
        <strong>{{ assets }}</strong>
      </article>
      <article class="statCard">
        <span class="statLabel">项目占用</span>
        <strong>{{ formatBytes(summary.totalSize) }}</strong>
      </article>
    </section>

    <section class="tableCard">
      <div class="tableHead">
        <div>
          <h3>工作区项目</h3>
          <p>删除会先移入数据目录的 .trash 回收站，不会立即销毁文件</p>
        </div>
        <button class="ghostButton" type="button" :disabled="loading" @click="load">
          <icon-refresh :size="14" aria-hidden="true" />
          刷新
        </button>
      </div>
      <el-table v-loading="loading" :data="items" style="width: 100%" :empty-text="loading ? '正在扫描工作区…' : '还没有项目'">
        <el-table-column label="项目" min-width="240">
          <template #default="{ row }">
            <div class="projectCell">
              <span class="projectIcon"><icon-folders :size="16" aria-hidden="true" /></span>
              <div class="projectCopy">
                <strong>{{ row.name }}</strong>
                <span>{{ row.canvasCount }} 个画布 · {{ row.assetCount }} 个素材</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="110" align="right">
          <template #default="{ row }"><span class="tabular">{{ formatBytes(row.size) }}</span></template>
        </el-table-column>
        <el-table-column label="画布" width="90" align="right">
          <template #default="{ row }"><span class="tabular">{{ row.canvasCount }}</span></template>
        </el-table-column>
        <el-table-column label="最后修改" width="170">
          <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <button class="rowAction danger" type="button" @click="removeProject(asProject(row))">删除</button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconFolders, IconRefresh } from "@tabler/icons-vue";
import { adminApi, formatBytes, formatDateTime, type ProjectItem } from "@/lib/admin";

const items = ref<ProjectItem[]>([]);
const totalSize = ref(0);
const loading = ref(false);
const asProject = (row: unknown) => row as ProjectItem;

const summary = computed(() => ({ total: items.value.length, totalSize: totalSize.value }));
const canvases = computed(() => items.value.reduce((sum, item) => sum + item.canvasCount, 0));
const assets = computed(() => items.value.reduce((sum, item) => sum + item.assetCount, 0));

async function load() {
  loading.value = true;
  try {
    const result = await adminApi.projects();
    items.value = result.items;
    totalSize.value = result.totalSize;
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "加载失败");
  } finally {
    loading.value = false;
  }
}

async function removeProject(project: ProjectItem) {
  try {
    await ElMessageBox.prompt(
      `即将把「${project.name}」移入回收站。请输入项目名称以确认：`,
      "删除项目",
      {
        type: "warning",
        confirmButtonText: "移入回收站",
        cancelButtonText: "取消",
        inputPlaceholder: project.name,
        inputValidator: (value: string) => value === project.name || "名称不一致，请重新输入",
        confirmButtonClass: "el-button--danger",
      },
    );
    await adminApi.deleteProject(project.name);
    ElMessage.success("项目已移入回收站");
    await load();
  } catch (cause) {
    if (cause === "cancel" || cause === "close") return;
    ElMessage.error(cause instanceof Error ? cause.message : "删除失败");
  }
}

onMounted(load);
</script>

<style scoped>
.projectsPage { display: flex; flex-direction: column; gap: 16px; }
.statRow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.statCard { padding: 14px 16px; border: 1px solid var(--el-border-color-lighter); border-radius: 11px; background: var(--el-bg-color); }
.statLabel { display: block; margin-bottom: 6px; color: var(--el-text-color-placeholder); font-size: 11px; }
.statCard strong { font-size: 21px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -0.3px; }
.tableCard { padding: 16px 18px 6px; border: 1px solid var(--el-border-color-lighter); border-radius: 12px; background: var(--el-bg-color); }
.tableHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.tableHead h3 { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
.tableHead p { margin: 0; color: var(--el-text-color-placeholder); font-size: 11px; }
.ghostButton { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 1px solid var(--el-border-color); border-radius: 7px; background: transparent; color: var(--el-text-color-regular); font-size: 11.5px; cursor: pointer; }
.ghostButton:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.projectCell { display: flex; align-items: center; gap: 10px; }
.projectIcon { display: grid; place-items: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); }
.projectCopy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.projectCopy strong { font-size: 12.5px; font-weight: 500; }
.projectCopy span { color: var(--el-text-color-placeholder); font-size: 10.5px; }
.tabular { font-variant-numeric: tabular-nums; }
.rowAction { padding: 0; border: 0; background: transparent; font-size: 11.5px; cursor: pointer; }
.rowAction.danger { color: var(--el-color-danger); }
.rowAction:hover { text-decoration: underline; }
@media (max-width: 900px) { .statRow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
