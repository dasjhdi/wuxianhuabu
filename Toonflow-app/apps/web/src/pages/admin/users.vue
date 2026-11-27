<template>
  <div class="usersPage">
    <section class="toolbar">
      <div class="toolbarLeft">
        <el-input v-model="query" class="searchInput" placeholder="搜索用户名或显示名称" clearable :prefix-icon="IconSearch" />
        <el-select v-model="roleFilter" class="roleSelect" placeholder="全部角色" clearable>
          <el-option label="管理员" value="admin" />
          <el-option label="成员" value="member" />
          <el-option label="只读" value="viewer" />
        </el-select>
      </div>
      <button class="primaryButton" type="button" @click="openCreate">
        <icon-user-plus :size="15" aria-hidden="true" />
        新建账号
      </button>
    </section>

    <section class="tableCard">
      <div class="tableHead">
        <div>
          <h3>成员列表</h3>
          <p>共 {{ total }} 个账号，管理员可重置密码或停用账号</p>
        </div>
        <button class="ghostButton" type="button" :disabled="loading" @click="load">
          <icon-refresh :size="14" aria-hidden="true" />
          刷新
        </button>
      </div>
      <el-table v-loading="loading" :data="rows" style="width: 100%" :empty-text="loading ? '加载中…' : '没有匹配的账号'">
        <el-table-column label="成员" min-width="220">
          <template #default="{ row }">
            <div class="memberCell">
              <span class="avatar" :class="row.role">{{ initial(asUser(row)) }}</span>
              <div class="memberCopy">
                <strong>{{ row.displayName }}</strong>
                <span>@{{ row.username }}</span>
              </div>
              <span v-if="row.id === authState.user?.id" class="selfBadge">当前账号</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="110">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'primary' : row.role === 'viewer' ? 'info' : 'success'" effect="light" size="small" round>
              {{ roleLabels[row.role] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span class="statusText" :class="row.status">
              <i />{{ row.status === "active" ? "已启用" : "已停用" }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" width="160">
          <template #default="{ row }">{{ relativeTime(row.lastLoginAt) }}</template>
        </el-table-column>
        <el-table-column label="登录次数" width="100" align="right">
          <template #default="{ row }"><span class="tabular">{{ row.loginCount }}</span></template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="235" fixed="right">
          <template #default="{ row }">
            <div class="rowActions">
              <button class="rowAction" type="button" @click="openEdit(asUser(row))">编辑</button>
              <button class="rowAction" type="button" @click="openReset(asUser(row))">重置密码</button>
              <button class="rowAction danger" type="button" :disabled="row.id === authState.user?.id" @click="removeUser(asUser(row))">删除</button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="createVisible" title="新建账号" width="440px" align-center>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-position="top">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="createForm.username" placeholder="3-32 位字母、数字或 _ . -" />
        </el-form-item>
        <el-form-item label="显示名称" prop="displayName">
          <el-input v-model="createForm.displayName" placeholder="例如：分镜师 / 剪辑师" />
        </el-form-item>
        <el-form-item label="初始密码" prop="password">
          <el-input v-model="createForm.password" type="password" show-password placeholder="至少 8 位，需包含字母和数字" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="createForm.role" style="width: 100%">
            <el-option label="成员 · 可创作" value="member" />
            <el-option label="只读 · 仅浏览" value="viewer" />
            <el-option label="管理员 · 全部权限" value="admin" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">创建账号</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑账号" width="440px" align-center>
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-position="top">
        <el-form-item label="显示名称" prop="displayName">
          <el-input v-model="editForm.displayName" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="editForm.role" style="width: 100%" :disabled="editForm.id === authState.user?.id">
            <el-option label="成员 · 可创作" value="member" />
            <el-option label="只读 · 仅浏览" value="viewer" />
            <el-option label="管理员 · 全部权限" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="账号状态">
          <el-switch v-model="editForm.active" active-text="启用" inactive-text="停用" :disabled="editForm.id === authState.user?.id" />
        </el-form-item>
        <p class="dialogHint">停用后该账号将立即无法登录，已有项目与作品不受影响。</p>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetVisible" title="重置登录密码" width="420px" align-center>
      <p class="dialogLead">为 <strong>{{ resetTarget?.displayName }}</strong> 设置新的登录密码，旧密码会立即失效。</p>
      <el-form ref="resetFormRef" :model="resetForm" :rules="resetRules" label-position="top">
        <el-form-item label="新密码" prop="password">
          <el-input v-model="resetForm.password" type="password" show-password placeholder="至少 8 位，需包含字母和数字" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitReset">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import { IconRefresh, IconSearch, IconUserPlus } from "@tabler/icons-vue";
import { authState } from "@/lib/auth";
import { adminApi, formatDateTime, relativeTime, roleLabels, type AdminUser } from "@/lib/admin";

const rows = ref<AdminUser[]>([]);
const total = ref(0);
const loading = ref(false);
const saving = ref(false);
const query = ref("");
const roleFilter = ref("");
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const createVisible = ref(false);
const editVisible = ref(false);
const resetVisible = ref(false);
const createFormRef = ref<FormInstance>();
const editFormRef = ref<FormInstance>();
const resetFormRef = ref<FormInstance>();
const resetTarget = ref<AdminUser | null>(null);

const createForm = reactive({ username: "", displayName: "", password: "", role: "member" });
const editForm = reactive({ id: 0, displayName: "", role: "member", active: true });
const resetForm = reactive({ password: "" });

const createRules: FormRules = {
  username: [
    { required: true, message: "请输入用户名", trigger: "blur" },
    { pattern: /^[a-zA-Z0-9_.-]{3,32}$/, message: "需为 3-32 位字母、数字或 _ . -", trigger: "blur" },
  ],
  password: [
    { required: true, message: "请输入初始密码", trigger: "blur" },
    { min: 8, message: "密码至少需要 8 位字符", trigger: "blur" },
  ],
};
const editRules: FormRules = { displayName: [{ required: true, message: "请输入显示名称", trigger: "blur" }] };
const resetRules: FormRules = {
  password: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    { min: 8, message: "密码至少需要 8 位字符", trigger: "blur" },
  ],
};

const initial = (user: AdminUser) => (user.displayName || user.username).slice(0, 1).toUpperCase();
const asUser = (row: unknown) => row as AdminUser;

async function load() {
  loading.value = true;
  try {
    const result = await adminApi.users({ q: query.value.trim() || undefined, role: roleFilter.value || undefined });
    rows.value = result.items;
    total.value = result.total;
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "加载失败");
  } finally {
    loading.value = false;
  }
}

watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 300);
});
watch(roleFilter, load);

function openCreate() {
  Object.assign(createForm, { username: "", displayName: "", password: "", role: "member" });
  createVisible.value = true;
}

function openEdit(user: AdminUser) {
  Object.assign(editForm, { id: user.id, displayName: user.displayName, role: user.role, active: user.status === "active" });
  editVisible.value = true;
}

function openReset(user: AdminUser) {
  resetTarget.value = user;
  resetForm.password = "";
  resetVisible.value = true;
}

async function submitCreate() {
  const valid = await createFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    await adminApi.createUser({ username: createForm.username.trim(), password: createForm.password, displayName: createForm.displayName.trim() || undefined, role: createForm.role });
    ElMessage.success("账号已创建");
    createVisible.value = false;
    await load();
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "创建失败");
  } finally {
    saving.value = false;
  }
}

async function submitEdit() {
  const valid = await editFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    await adminApi.updateUser({ id: editForm.id, displayName: editForm.displayName.trim(), role: editForm.role, status: editForm.active ? "active" : "disabled" });
    ElMessage.success("账号已更新");
    editVisible.value = false;
    await load();
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

async function submitReset() {
  const valid = await resetFormRef.value?.validate().catch(() => false);
  if (!valid || !resetTarget.value) return;
  saving.value = true;
  try {
    await adminApi.resetPassword(resetTarget.value.id, resetForm.password);
    ElMessage.success("密码已重置");
    resetVisible.value = false;
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "重置失败");
  } finally {
    saving.value = false;
  }
}

async function removeUser(user: AdminUser) {
  try {
    await ElMessageBox.confirm(`删除账号「${user.displayName}」后无法恢复，该成员的登录权限会立即失效。`, "确认删除账号", {
      type: "warning", confirmButtonText: "删除", cancelButtonText: "取消", confirmButtonClass: "el-button--danger",
    });
    await adminApi.deleteUser(user.id);
    ElMessage.success("账号已删除");
    await load();
  } catch (cause) {
    if (cause === "cancel" || cause === "close") return;
    ElMessage.error(cause instanceof Error ? cause.message : "删除失败");
  }
}

onMounted(load);
</script>

<style scoped>
.usersPage { display: flex; flex-direction: column; gap: 16px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.toolbarLeft { display: flex; gap: 10px; }
.searchInput { width: 260px; }
.roleSelect { width: 130px; }
.primaryButton {
  display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px; border: 0; border-radius: 8px;
  background: var(--el-color-primary); color: #fff; font-size: 12.5px; cursor: pointer;
  box-shadow: 0 5px 14px color-mix(in srgb, var(--el-color-primary) 28%, transparent);
}
.tableCard { padding: 16px 18px 6px; border: 1px solid var(--el-border-color-lighter); border-radius: 12px; background: var(--el-bg-color); }
.tableHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.tableHead h3 { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
.tableHead p { margin: 0; color: var(--el-text-color-placeholder); font-size: 11px; }
.ghostButton { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 1px solid var(--el-border-color); border-radius: 7px; background: transparent; color: var(--el-text-color-regular); font-size: 11.5px; cursor: pointer; }
.ghostButton:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.memberCell { display: flex; align-items: center; gap: 10px; }
.avatar {
  display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%;
  background: linear-gradient(140deg, #5a37e0, #8f6bff); color: #fff; font-size: 11.5px; font-weight: 600;
}
.avatar.admin { background: linear-gradient(140deg, #8f6bff, #4a2ed6); }
.avatar.viewer { background: linear-gradient(140deg, #64748b, #94a3b8); }
.memberCopy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.memberCopy strong { font-size: 12.5px; font-weight: 500; }
.memberCopy span { color: var(--el-text-color-placeholder); font-size: 10.5px; }
.selfBadge { padding: 1px 6px; border-radius: 20px; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 9.5px; }
.statusText { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; }
.statusText i { width: 6px; height: 6px; border-radius: 50%; background: #3fbfb4; }
.statusText.disabled { color: var(--el-text-color-placeholder); }
.statusText.disabled i { background: #c2c8d2; }
.tabular { font-variant-numeric: tabular-nums; }
.rowActions { display: flex; gap: 10px; }
.rowAction { padding: 0; border: 0; background: transparent; color: var(--el-color-primary); font-size: 11.5px; cursor: pointer; }
.rowAction:hover { text-decoration: underline; }
.rowAction.danger { color: var(--el-color-danger); }
.rowAction:disabled { color: var(--el-text-color-disabled); cursor: not-allowed; text-decoration: none; }
.dialogLead { margin: 0 0 16px; color: var(--el-text-color-regular); font-size: 12.5px; line-height: 1.6; }
.dialogHint { margin: 4px 0 0; color: var(--el-text-color-placeholder); font-size: 11px; line-height: 1.6; }
@media (max-width: 760px) { .toolbar { flex-direction: column; align-items: stretch; } .toolbarLeft { flex-wrap: wrap; } .searchInput { flex: 1; min-width: 180px; } }
</style>
