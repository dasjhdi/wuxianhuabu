<template>
  <div class="adminShell">
    <aside class="adminSidebar">
      <div class="sidebarBrand">
        <span class="brandMark">创</span>
        <div class="brandCopy">
          <strong>{{ authState.system.siteName || "创梦" }}</strong>
          <span>管理后台</span>
        </div>
      </div>

      <nav class="sidebarNav" aria-label="后台导航">
        <p class="navGroup">总览</p>
        <router-link v-for="item in overviewNav" :key="item.path" :to="item.path" class="navItem" :class="{ active: isActive(item.path) }">
          <component :is="item.icon" :size="17" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </router-link>
        <p class="navGroup">运营</p>
        <router-link v-for="item in operationNav" :key="item.path" :to="item.path" class="navItem" :class="{ active: isActive(item.path) }">
          <component :is="item.icon" :size="17" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </router-link>
        <p class="navGroup">系统</p>
        <router-link v-for="item in systemNav" :key="item.path" :to="item.path" class="navItem" :class="{ active: isActive(item.path) }">
          <component :is="item.icon" :size="17" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="sidebarFooter">
        <a class="backLink" href="#/home">
          <icon-arrow-left :size="15" aria-hidden="true" />
          <span>返回创作空间</span>
        </a>
        <div class="accountChip">
          <span class="avatar">{{ initials }}</span>
          <div class="accountCopy">
            <strong>{{ authState.user?.displayName }}</strong>
            <span>{{ roleLabel }}</span>
          </div>
        </div>
      </div>
    </aside>

    <div class="adminMain">
      <header class="adminHeader">
        <div class="headerTitle">
          <h1>{{ pageTitle }}</h1>
          <p>{{ pageSubtitle }}</p>
        </div>
        <div class="headerActions">
          <button class="ghostButton" type="button" @click="passwordVisible = true">
            <icon-key :size="15" aria-hidden="true" />
            <span class="actionText">修改密码</span>
          </button>
          <el-dropdown trigger="click" @command="handleCommand">
            <button class="userButton" type="button">
              <span class="avatar small">{{ initials }}</span>
              <span class="actionText">{{ authState.user?.displayName }}</span>
              <icon-chevron-down :size="14" aria-hidden="true" />
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="home">返回创作空间</el-dropdown-item>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="adminContent">
        <router-view />
      </main>
    </div>

    <el-dialog v-model="passwordVisible" title="修改登录密码" width="420px" align-center>
      <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-position="top">
        <el-form-item label="当前密码" prop="currentPassword">
          <el-input v-model="passwordForm.currentPassword" type="password" show-password placeholder="请输入当前密码" />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="passwordForm.newPassword" type="password" show-password placeholder="至少 8 位，需包含字母和数字" />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input v-model="passwordForm.confirmPassword" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordVisible = false">取消</el-button>
        <el-button type="primary" :loading="passwordSaving" @click="submitPassword">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import { IconArrowLeft, IconChartBar, IconChevronDown, IconFolders, IconHistory, IconKey, IconLayoutDashboard, IconSettings, IconUsers } from "@tabler/icons-vue";
import { authState, changePassword, logout } from "@/lib/auth";

const route = useRoute();
const router = useRouter();

const overviewNav = [{ path: "/admin", label: "仪表盘", icon: IconLayoutDashboard }];
const operationNav = [
  { path: "/admin/users", label: "成员管理", icon: IconUsers },
  { path: "/admin/projects", label: "项目管理", icon: IconFolders },
  { path: "/admin/usage", label: "用量统计", icon: IconChartBar },
];
const systemNav = [
  { path: "/admin/audit", label: "操作日志", icon: IconHistory },
  { path: "/admin/settings", label: "系统设置", icon: IconSettings },
];

const isActive = (path: string) => path === "/admin" ? route.path === "/admin" : route.path.startsWith(path);
const pageTitle = computed(() => String(route.meta.title ?? "管理后台"));
const pageSubtitle = computed(() => String(route.meta.subtitle ?? ""));
const initials = computed(() => (authState.user?.displayName || authState.user?.username || "?").slice(0, 1).toUpperCase());
const roleLabel = computed(() => ({ admin: "管理员", member: "成员", viewer: "只读" }[authState.user?.role ?? "member"]));

const passwordVisible = ref(false);
const passwordSaving = ref(false);
const passwordFormRef = ref<FormInstance>();
const passwordForm = reactive({ currentPassword: "", newPassword: "", confirmPassword: "" });
const passwordRules: FormRules = {
  currentPassword: [{ required: true, message: "请输入当前密码", trigger: "blur" }],
  newPassword: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    { min: 8, message: "密码至少需要 8 位字符", trigger: "blur" },
  ],
  confirmPassword: [{
    validator: (_rule, value: string, callback) => value === passwordForm.newPassword ? callback() : callback(new Error("两次输入的密码不一致")),
    trigger: "blur",
  }],
};

async function submitPassword() {
  const valid = await passwordFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  passwordSaving.value = true;
  try {
    await changePassword(passwordForm.currentPassword, passwordForm.newPassword);
    ElMessage.success("密码已更新");
    passwordVisible.value = false;
    passwordForm.currentPassword = "";
    passwordForm.newPassword = "";
    passwordForm.confirmPassword = "";
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "修改失败");
  } finally {
    passwordSaving.value = false;
  }
}

async function handleCommand(command: string) {
  if (command === "home") return void router.push("/home");
  if (command === "password") return void (passwordVisible.value = true);
  if (command === "logout") {
    await logout();
    await router.replace("/login");
  }
}
</script>

<style scoped>
.adminShell { display: flex; min-height: 100vh; background: var(--el-bg-color-page); color: var(--el-text-color-primary); }
.adminSidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  width: 236px;
  height: 100vh;
  flex-shrink: 0;
  padding: 22px 14px 16px;
  background: #0d0f14;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}
.sidebarBrand { display: flex; align-items: center; gap: 10px; padding: 0 8px 22px; }
.brandMark {
  display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px;
  background: linear-gradient(140deg, #8f6bff, #4a2ed6); color: #fff; font-size: 14px; font-weight: 700;
  box-shadow: 0 6px 18px rgba(109, 77, 255, 0.35);
}
.brandCopy { display: flex; flex-direction: column; gap: 1px; }
.brandCopy strong { color: #eef0f6; font-size: 14px; font-weight: 600; letter-spacing: 1px; }
.brandCopy span { color: rgba(232, 234, 241, 0.36); font-size: 10.5px; letter-spacing: 0.5px; }
.sidebarNav { flex: 1; overflow-y: auto; }
.navGroup { margin: 16px 10px 6px; color: rgba(232, 234, 241, 0.28); font-size: 10px; font-weight: 600; letter-spacing: 1.4px; }
.navItem {
  display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 10px; margin-bottom: 2px;
  border-radius: 8px; color: rgba(232, 234, 241, 0.66); font-size: 13px; text-decoration: none;
  transition: background 0.16s ease, color 0.16s ease;
}
.navItem:hover { background: rgba(255, 255, 255, 0.05); color: #eef0f6; }
.navItem.active { background: rgba(143, 107, 255, 0.14); color: #c3b3ff; box-shadow: 0 0 0 1px rgba(143, 107, 255, 0.22) inset; }
.sidebarFooter { padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.06); }
.backLink { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; color: rgba(232, 234, 241, 0.5); font-size: 12.5px; text-decoration: none; }
.backLink:hover { background: rgba(255, 255, 255, 0.05); color: #eef0f6; }
.accountChip { display: flex; align-items: center; gap: 9px; margin-top: 8px; padding: 9px 10px; border-radius: 9px; background: rgba(255, 255, 255, 0.04); }
.avatar {
  display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%;
  background: linear-gradient(140deg, #5a37e0, #8f6bff); color: #fff; font-size: 12px; font-weight: 600;
}
.avatar.small { width: 24px; height: 24px; font-size: 11px; }
.accountCopy { display: flex; flex-direction: column; min-width: 0; }
.accountCopy strong { overflow: hidden; color: #eef0f6; font-size: 12.5px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.accountCopy span { color: rgba(232, 234, 241, 0.36); font-size: 10.5px; }

.adminMain { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.adminHeader {
  position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 20px 32px; background: color-mix(in srgb, var(--el-bg-color-page) 88%, transparent);
  border-bottom: 1px solid var(--el-border-color-lighter); backdrop-filter: blur(10px);
}
.headerTitle h1 { margin: 0 0 3px; font-size: 19px; font-weight: 600; letter-spacing: -0.2px; }
.headerTitle p { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; }
.headerActions { display: flex; align-items: center; gap: 8px; }
.ghostButton, .userButton {
  display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 12px; border: 1px solid var(--el-border-color);
  border-radius: 8px; background: var(--el-bg-color); color: var(--el-text-color-regular); font-size: 12.5px; cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease;
}
.ghostButton:hover, .userButton:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.adminContent { flex: 1; padding: 24px 32px 40px; }

@media (max-width: 900px) {
  .adminSidebar { width: 64px; padding: 18px 8px 12px; }
  .brandCopy, .navGroup, .navItem span, .backLink span, .accountCopy { display: none; }
  .navItem { justify-content: center; padding: 0; }
  .sidebarBrand { justify-content: center; padding: 0 0 18px; }
  .accountChip { justify-content: center; padding: 6px; }
  .adminHeader { padding: 16px 18px; }
  .adminContent { padding: 18px; }
  .actionText { display: none; }
}
</style>
