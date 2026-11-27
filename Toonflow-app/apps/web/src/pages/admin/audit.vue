<template>
  <div class="auditPage">
    <section class="toolbar">
      <el-input v-model="query" class="searchInput" placeholder="搜索操作者、详情或动作" clearable :prefix-icon="IconSearch" />
      <el-select v-model="action" class="actionSelect" placeholder="全部动作" clearable>
        <el-option v-for="option in actionOptions" :key="option.value" :label="option.label" :value="option.value" />
      </el-select>
      <button class="ghostButton" type="button" :disabled="loading" @click="load">
        <icon-refresh :size="14" aria-hidden="true" />
        刷新
      </button>
    </section>

    <section class="tableCard">
      <div class="tableHead">
        <div>
          <h3>操作日志</h3>
          <p>共 {{ total }} 条记录，保留最近 90 天的关键行为</p>
        </div>
        <span class="retention">审计留存 · 仅管理员可见</span>
      </div>
      <el-table v-loading="loading" :data="items" style="width: 100%" :empty-text="loading ? '加载中…' : '没有匹配的记录'">
        <el-table-column label="时间" width="170">
          <template #default="{ row }"><span class="timeCell">{{ formatDateTime(row.created_at) }}</span></template>
        </el-table-column>
        <el-table-column label="操作者" width="150">
          <template #default="{ row }">
            <span class="operator">{{ row.username || "系统" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="动作" width="150">
          <template #default="{ row }">
            <span class="actionTag" :class="tagClass(row.action)">{{ actionLabels[row.action] ?? row.action }}</span>
          </template>
        </el-table-column>
        <el-table-column label="对象" width="150">
          <template #default="{ row }">
            <span class="targetText">{{ row.target_type ? `${row.target_type} · ${row.target_id ?? ""}` : "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="详情" min-width="260" show-overflow-tooltip>
          <template #default="{ row }"><span class="detailText">{{ row.detail || "—" }}</span></template>
        </el-table-column>
        <el-table-column label="IP" width="130">
          <template #default="{ row }"><span class="ipText">{{ row.ip || "—" }}</span></template>
        </el-table-column>
      </el-table>
      <div class="paginationRow">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          background
          small
          @current-change="load"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { IconRefresh, IconSearch } from "@tabler/icons-vue";
import { actionLabels, adminApi, formatDateTime, type AuditItem } from "@/lib/admin";

const items = ref<AuditItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const query = ref("");
const action = ref("");
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const actionOptions = [
  { label: "登录", value: "login" },
  { label: "退出", value: "logout" },
  { label: "账号管理", value: "user" },
  { label: "密码", value: "password" },
  { label: "项目", value: "project" },
  { label: "系统设置", value: "settings" },
  { label: "系统初始化", value: "system" },
];

const tagClass = (value: string) => value.includes("failed") || value.includes("delete") ? "danger" : value.includes("success") || value.includes("setup") ? "success" : "normal";

async function load() {
  loading.value = true;
  try {
    const result = await adminApi.audit({ page: page.value, pageSize, q: query.value.trim() || undefined, action: action.value || undefined });
    items.value = result.items;
    total.value = result.total;
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "加载失败");
  } finally {
    loading.value = false;
  }
}

watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void load();
  }, 300);
});
watch(action, () => {
  page.value = 1;
  void load();
});

onMounted(load);
</script>

<style scoped>
.auditPage { display: flex; flex-direction: column; gap: 16px; }
.toolbar { display: flex; align-items: center; gap: 10px; }
.searchInput { width: 280px; }
.actionSelect { width: 140px; }
.ghostButton { display: flex; align-items: center; gap: 6px; height: 31px; padding: 0 10px; border: 1px solid var(--el-border-color); border-radius: 7px; background: transparent; color: var(--el-text-color-regular); font-size: 11.5px; cursor: pointer; }
.ghostButton:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.tableCard { padding: 16px 18px 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 12px; background: var(--el-bg-color); }
.tableHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.tableHead h3 { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
.tableHead p { margin: 0; color: var(--el-text-color-placeholder); font-size: 11px; }
.retention { padding: 3px 8px; border-radius: 20px; background: var(--el-fill-color-light); color: var(--el-text-color-placeholder); font-size: 10px; }
.timeCell, .ipText { color: var(--el-text-color-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.operator { font-size: 12px; font-weight: 500; }
.actionTag { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; background: var(--el-fill-color-light); color: var(--el-text-color-regular); font-size: 10.5px; }
.actionTag.success { background: rgba(63, 191, 180, 0.12); color: #2f9e94; }
.actionTag.danger { background: rgba(239, 107, 107, 0.12); color: #d25555; }
.targetText { color: var(--el-text-color-secondary); font-size: 11px; }
.detailText { color: var(--el-text-color-regular); font-size: 11.5px; }
.paginationRow { display: flex; justify-content: flex-end; padding: 12px 0 4px; }
@media (max-width: 760px) { .toolbar { flex-wrap: wrap; } .searchInput { flex: 1; min-width: 180px; } }
</style>
