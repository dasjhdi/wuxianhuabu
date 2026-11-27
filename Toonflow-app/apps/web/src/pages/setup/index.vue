<template>
  <authShell title="初始化系统" subtitle="这是系统的第一次启动。创建一个管理员账号，之后所有成员都由你分配。">
    <el-form ref="formRef" class="authForm" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
      <el-form-item label="管理员用户名" prop="username">
        <el-input v-model="form.username" size="large" placeholder="3-32 位字母、数字或 _ . -" autocomplete="username" :disabled="loading" />
      </el-form-item>
      <el-form-item label="显示名称" prop="displayName">
        <el-input v-model="form.displayName" size="large" placeholder="例如：导演 / 制片人" :disabled="loading" />
      </el-form-item>
      <el-form-item label="登录密码" prop="password">
        <el-input v-model="form.password" size="large" type="password" show-password placeholder="至少 8 位，需包含字母和数字" autocomplete="new-password" :disabled="loading" />
      </el-form-item>
      <el-form-item label="确认密码" prop="confirmPassword">
        <el-input v-model="form.confirmPassword" size="large" type="password" show-password placeholder="再次输入密码" autocomplete="new-password" :disabled="loading" @keyup.enter="submit" />
      </el-form-item>
      <div class="strengthRow">
        <span v-for="index in 3" :key="index" class="strengthBar" :class="{ filled: strength >= index }" />
        <span class="strengthLabel">{{ strengthLabel }}</span>
      </div>
      <p v-if="error" class="errorText" role="alert">{{ error }}</p>
      <button class="submitButton" type="button" :disabled="loading" @click="submit">
        <span v-if="loading" class="spinner" aria-hidden="true" />
        {{ loading ? "正在创建…" : "创建管理员并进入" }}
      </button>
    </el-form>
    <template #footer>
      <p class="bottomHint">已经初始化过？<a class="textLink" href="#/login">返回登录</a></p>
    </template>
  </authShell>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import authShell from "@/components/authShell.vue";
import { setupAccount } from "@/lib/auth";

const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);
const error = ref("");
const form = reactive({ username: "", displayName: "", password: "", confirmPassword: "" });

const strength = computed(() => {
  let score = 0;
  if (form.password.length >= 8) score += 1;
  if (/[a-zA-Z]/.test(form.password) && /\d/.test(form.password)) score += 1;
  if (form.password.length >= 12 || /[^a-zA-Z0-9]/.test(form.password)) score += 1;
  return score;
});
const strengthLabel = computed(() => ["太短", "较弱", "可用", "较强"][strength.value]);

const rules: FormRules = {
  username: [
    { required: true, message: "请输入管理员用户名", trigger: "blur" },
    { pattern: /^[a-zA-Z0-9_.-]{3,32}$/, message: "需为 3-32 位字母、数字或 _ . -", trigger: "blur" },
  ],
  password: [
    { required: true, message: "请设置登录密码", trigger: "blur" },
    { min: 8, message: "密码至少需要 8 位字符", trigger: "blur" },
    {
      validator: (_rule, value: string, callback) => {
        if (value && (!/[a-zA-Z]/.test(value) || !/\d/.test(value))) callback(new Error("密码需要同时包含字母和数字"));
        else callback();
      },
      trigger: "blur",
    },
  ],
  confirmPassword: [
    { required: true, message: "请再次输入密码", trigger: "blur" },
    {
      validator: (_rule, value: string, callback) => {
        if (value !== form.password) callback(new Error("两次输入的密码不一致"));
        else callback();
      },
      trigger: "blur",
    },
  ],
};

async function submit() {
  if (loading.value) return;
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  error.value = "";
  try {
    await setupAccount({ username: form.username.trim(), password: form.password, displayName: form.displayName.trim() || undefined });
    ElMessage.success("管理员账号已创建");
    await router.replace("/home");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "初始化失败，请重试";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.strengthRow { display: flex; align-items: center; gap: 6px; margin: -4px 0 18px; }
.strengthBar { height: 3px; flex: 1; border-radius: 2px; background: rgba(255, 255, 255, 0.1); transition: background 0.2s ease; }
.strengthBar.filled { background: linear-gradient(90deg, #8f6bff, #5fd0c5); }
.strengthLabel { width: 34px; color: rgba(232, 234, 241, 0.4); font-size: 11px; text-align: right; }
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
@keyframes spin { to { transform: rotate(360deg); } }
</style>
