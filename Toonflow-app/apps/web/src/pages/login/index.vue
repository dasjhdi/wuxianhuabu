<template>
  <div class="loginPage">
    <authShell title="登录工作台" subtitle="使用管理员分配的账号，进入你的短剧创作空间。">
    <el-form ref="formRef" class="authForm" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
      <el-form-item label="用户名" prop="username">
        <el-input v-model="form.username" size="large" placeholder="请输入用户名" autocomplete="username" :disabled="loading" @keyup.enter="submit" />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input v-model="form.password" size="large" type="password" show-password placeholder="请输入密码" autocomplete="current-password" :disabled="loading" @keyup.enter="submit" />
      </el-form-item>
      <div class="formRow">
        <el-checkbox v-model="form.remember" :disabled="loading">保持登录 30 天</el-checkbox>
        <span class="rowHint">忘记密码请联系管理员</span>
      </div>
      <p v-if="error" class="errorText" role="alert">{{ error }}</p>
      <button class="submitButton" type="button" :disabled="loading" @click="submit">
        <span v-if="loading" class="spinner" aria-hidden="true" />
        {{ loading ? "正在登录…" : "登录" }}
      </button>
    </el-form>
    <template #footer>
      <p v-if="authState.system.allowRegister" class="bottomHint">
        还没有账号？<button class="textButton" type="button" @click="registerVisible = true">注册新账号</button>
      </p>
      <p v-else class="bottomHint">首次部署这套系统？<a class="textLink" href="#/setup">初始化管理员账号</a></p>
    </template>
    </authShell>

    <el-dialog v-model="registerVisible" title="注册账号" width="420px" align-center>
      <p class="dialogLead">注册后将以「{{ authState.system.defaultRole === "viewer" ? "只读" : "成员" }}」身份加入，管理员可随时调整权限。</p>
      <el-form ref="registerFormRef" class="registerForm" :model="registerForm" :rules="registerRules" label-position="top">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="registerForm.username" placeholder="3-32 位字母、数字或 _ . -" />
        </el-form-item>
        <el-form-item label="显示名称" prop="displayName">
          <el-input v-model="registerForm.displayName" placeholder="例如：编剧 / 剪辑师" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="registerForm.password" type="password" show-password placeholder="至少 8 位，需包含字母和数字" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="registerVisible = false">取消</el-button>
        <el-button type="primary" :loading="registering" @click="submitRegister">注册并登录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import authShell from "@/components/authShell.vue";
import { authState, login, refreshAuth, registerAccount } from "@/lib/auth";

const router = useRouter();
const route = useRoute();
const formRef = ref<FormInstance>();
const loading = ref(false);
const error = ref("");
const form = reactive({ username: "", password: "", remember: true });
const rules: FormRules = {
  username: [{ required: true, message: "请输入用户名", trigger: "blur" }],
  password: [{ required: true, message: "请输入密码", trigger: "blur" }],
};

onMounted(() => {
  const reason = typeof route.query.reason === "string" ? route.query.reason : "";
  if (reason) error.value = reason;
  void refreshAuth().catch(() => null);
});

const registerVisible = ref(false);
const registering = ref(false);
const registerFormRef = ref<FormInstance>();
const registerForm = reactive({ username: "", displayName: "", password: "" });
const registerRules: FormRules = {
  username: [
    { required: true, message: "请输入用户名", trigger: "blur" },
    { pattern: /^[a-zA-Z0-9_.-]{3,32}$/, message: "需为 3-32 位字母、数字或 _ . -", trigger: "blur" },
  ],
  password: [
    { required: true, message: "请设置密码", trigger: "blur" },
    { min: 8, message: "密码至少需要 8 位字符", trigger: "blur" },
  ],
};

async function submitRegister() {
  const valid = await registerFormRef.value?.validate().catch(() => false);
  if (!valid || registering.value) return;
  registering.value = true;
  try {
    await registerAccount({ username: registerForm.username.trim(), password: registerForm.password, displayName: registerForm.displayName.trim() || undefined });
    ElMessage.success("注册成功");
    registerVisible.value = false;
    await router.replace("/home");
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "注册失败");
  } finally {
    registering.value = false;
  }
}

async function submit() {
  if (loading.value) return;
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  error.value = "";
  try {
    await login(form.username.trim(), form.password, form.remember);
    const requested = typeof route.query.redirect === "string" ? route.query.redirect : "";
    const redirect = requested.startsWith("/") && !["/", "/hello", "/login", "/setup"].includes(requested) ? requested : "/home";
    await router.replace(redirect);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "登录失败，请重试";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.formRow { display: flex; align-items: center; justify-content: space-between; margin: -2px 0 20px; }
.rowHint { color: rgba(232, 234, 241, 0.34); font-size: 12px; }
.errorText {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 9px;
  background: rgba(255, 92, 92, 0.1);
  box-shadow: 0 0 0 1px rgba(255, 92, 92, 0.22) inset;
  color: #ff9c9c;
  font-size: 12.5px;
  line-height: 1.5;
}
.submitButton {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  margin-top: 4px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(140deg, #8f6bff, #5a37e0);
  box-shadow: 0 10px 26px rgba(109, 77, 255, 0.32);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
}
.submitButton:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 30px rgba(109, 77, 255, 0.4); }
.submitButton:active:not(:disabled) { transform: translateY(0); }
.submitButton:disabled { opacity: 0.7; cursor: default; }
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.bottomHint { margin: 22px 0 0; color: rgba(232, 234, 241, 0.36); font-size: 12.5px; text-align: center; }
.textLink { color: #a58cff; text-decoration: none; }
.textLink:hover { text-decoration: underline; }
.textButton { padding: 0; border: 0; background: transparent; color: #a58cff; font-size: 12.5px; cursor: pointer; }
.textButton:hover { text-decoration: underline; }
.dialogLead { margin: 0 0 16px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
.registerForm :deep(.el-form-item) { margin-bottom: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
