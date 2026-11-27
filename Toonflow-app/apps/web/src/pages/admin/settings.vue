<template>
  <div class="settingsPage">
    <section class="panel">
      <header class="panelHeader">
        <div>
          <h3>站点与访问</h3>
          <p>影响所有成员的登录与显示方式</p>
        </div>
        <button class="primaryButton" type="button" :disabled="saving || loading" @click="save">
          <span v-if="saving" class="spinner" aria-hidden="true" />
          {{ saving ? "保存中…" : "保存设置" }}
        </button>
      </header>

      <el-form v-loading="loading" class="settingsForm" label-position="top">
        <div class="formGrid">
          <el-form-item label="站点名称">
            <el-input v-model="form.siteName" maxlength="40" placeholder="显示在登录页与侧边栏" />
          </el-form-item>
          <el-form-item label="登录有效期（天）">
            <el-input-number v-model="form.sessionDays" :min="1" :max="30" controls-position="right" style="width: 100%" />
          </el-form-item>
        </div>
        <div class="formGrid">
          <el-form-item label="默认新账号角色">
            <el-select v-model="form.defaultRole" style="width: 100%">
              <el-option label="成员 · 可创作" value="member" />
              <el-option label="只读 · 仅浏览" value="viewer" />
            </el-select>
          </el-form-item>
          <el-form-item label="开放自助注册">
            <div class="switchRow">
              <el-switch v-model="form.allowRegister" />
              <span class="switchHint">开启后允许访客自行注册</span>
            </div>
          </el-form-item>
        </div>
        <el-form-item label="未开通提示">
          <el-input v-model="form.registrationNotice" maxlength="200" placeholder="显示给无账号成员的提示文案" />
        </el-form-item>
      </el-form>
    </section>

    <section class="panel">
      <header class="panelHeader">
        <div>
          <h3>电商与抠图</h3>
          <p>商品套图依赖第三方抠图服务保留商品原始像素</p>
        </div>
        <div class="panelActions">
          <button class="testButton" type="button" :disabled="testingMatting || ecomSaving || loading" @click="testMatting">
            {{ testingMatting ? "测试中…" : "测试已保存配置" }}
          </button>
          <button class="primaryButton" type="button" :disabled="ecomSaving || testingMatting || loading" @click="saveEcom">
            <span v-if="ecomSaving" class="spinner" aria-hidden="true" />
            {{ ecomSaving ? "保存中…" : "保存配置" }}
          </button>
        </div>
      </header>
      <el-form label-position="top" class="settingsForm">
        <div class="formGrid">
          <el-form-item label="抠图服务">
            <el-select v-model="ecom.provider" style="width: 100%">
              <el-option label="Photoroom" value="photoroom" />
              <el-option label="Remove.bg" value="removebg" />
              <el-option label="自定义接口" value="custom" />
            </el-select>
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="ecom.apiKey" type="password" show-password :placeholder="ecomConfigured ? '已配置，留空保持不变' : '粘贴第三方抠图 API Key'" />
          </el-form-item>
        </div>
        <el-form-item v-if="ecom.provider === 'custom'" label="自定义接口地址">
          <el-input v-model="ecom.endpoint" placeholder="https://your-service/matting" />
        </el-form-item>
        <div class="formGrid">
          <el-form-item label="数字人服务">
            <el-select v-model="ecom.avatarProvider" style="width: 100%">
              <el-option label="不启用（静态口播）" value="none" />
              <el-option label="D-ID" value="did" />
              <el-option label="自定义接口" value="custom" />
            </el-select>
          </el-form-item>
          <el-form-item label="数字人 API Key">
            <el-input v-model="ecom.avatarKey" type="password" show-password :placeholder="avatarConfigured ? '已配置，留空保持不变' : '粘贴数字人服务 Key'" />
          </el-form-item>
        </div>
        <el-form-item v-if="ecom.avatarProvider === 'custom'" label="数字人接口地址">
          <el-input v-model="ecom.avatarEndpoint" placeholder="https://your-service/avatar" />
        </el-form-item>
        <el-form-item label="默认场景模型">
          <el-select v-model="ecom.modelKey" style="width: 100%" filterable clearable placeholder="使用第一个可用图片模型">
            <el-option v-for="model in imageModels" :key="`${model.providerId}:${model.modelId}`" :label="`${model.providerLabel} · ${model.label}${model.configured === false ? '（未配置）' : ''}`" :value="`${model.providerId}:${model.modelId}`" />
          </el-select>
        </el-form-item>
        <p class="ecomHint">抠图密钥只保存在服务端，不会回传给只读账号。Photoroom 与 Remove.bg 走官方接口；自定义接口需支持 multipart 上传，返回 PNG 或图片地址。</p>
      </el-form>
    </section>

    <section class="panel">
      <header class="panelHeader">
        <div>
          <h3>运行环境</h3>
          <p>当前服务端进程与数据目录信息</p>
        </div>
      </header>
      <div class="infoGrid">
        <div v-for="item in runtimeItems" :key="item.label" class="infoItem">
          <span>{{ item.label }}</span>
          <strong :title="item.value">{{ item.value }}</strong>
        </div>
      </div>
    </section>

    <section class="panel">
      <header class="panelHeader">
        <div>
          <h3>模型供应商</h3>
          <p>仅显示配置状态，密钥不会在后台展示</p>
        </div>
      </header>
      <div class="providerList">
        <article v-for="provider in settings?.providers ?? []" :key="`${provider.kind}:${provider.id}`" class="providerItem">
          <span class="providerIcon" :class="provider.kind"><icon-plug-connected :size="15" aria-hidden="true" /></span>
          <div class="providerCopy">
            <strong>{{ provider.name }}</strong>
            <span>{{ provider.kind === "account" ? "官方账号" : provider.kind === "media" ? "媒体供应商" : "自定义供应商" }}<template v-if="provider.models"> · {{ provider.models }} 个模型</template></span>
          </div>
          <span class="providerState" :class="{ on: provider.configured }">
            <i />{{ provider.configured ? "已配置" : "未配置" }}
          </span>
        </article>
        <p v-if="!settings?.providers.length" class="emptyText">还没有配置供应商</p>
      </div>
    </section>

    <section class="securityNote">
      <icon-shield-lock :size="17" aria-hidden="true" />
      <div>
        <strong>安全建议</strong>
        <p>管理员账号只分配给必要人员；成员离职后请及时停用账号。系统会在操作日志中记录登录失败、账号变更与项目删除等关键行为。</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { IconPlugConnected, IconShieldLock } from "@tabler/icons-vue";
import { authState, refreshAuth } from "@/lib/auth";
import { adminApi, formatBytes, type AdminSettings } from "@/lib/admin";
import { ecommerceApi, type EcomModel } from "@/lib/ecommerce";

const settings = ref<AdminSettings | null>(null);
const loading = ref(true);
const saving = ref(false);
const form = reactive({ siteName: "创梦", sessionDays: 7, defaultRole: "member", allowRegister: false, registrationNotice: "请联系管理员开通账号" });
const ecomConfigured = ref(false);
const avatarConfigured = ref(false);
const ecomSaving = ref(false);
const testingMatting = ref(false);
const imageModels = ref<EcomModel[]>([]);
const ecom = reactive({ provider: "photoroom", apiKey: "", endpoint: "", modelKey: "", avatarProvider: "none", avatarKey: "", avatarEndpoint: "" });

const runtimeItems = computed(() => {
  const runtime = settings.value?.runtime;
  if (!runtime) return [];
  return [
    { label: "应用版本", value: runtime.version || "开发版" },
    { label: "运行平台", value: `${runtime.platform} / ${runtime.arch}` },
    { label: "Bun 版本", value: runtime.bun || "—" },
    { label: "数据目录", value: runtime.dataDirectory },
    { label: "存储占用", value: `${formatBytes(runtime.storageBytes)} · ${runtime.storageFiles} 个文件` },
  ];
});

async function load() {
  loading.value = true;
  try {
    const [data, ecomData, models] = await Promise.all([adminApi.settings(), ecommerceApi.config(), ecommerceApi.models()]);
    settings.value = data;
    Object.assign(form, data.system);
    ecomConfigured.value = ecomData.matting.configured;
    ecom.provider = ecomData.matting.provider;
    ecom.endpoint = ecomData.matting.endpoint;
    avatarConfigured.value = ecomData.avatar.configured;
    ecom.avatarProvider = ecomData.avatar.provider;
    ecom.avatarEndpoint = ecomData.avatar.endpoint;
    ecom.modelKey = ecomData.scene.providerId && ecomData.scene.modelId ? `${ecomData.scene.providerId}:${ecomData.scene.modelId}` : "";
    imageModels.value = models.filter(model => model.type === "image");
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "加载失败");
  } finally {
    loading.value = false;
  }
}

async function saveEcom() {
  ecomSaving.value = true;
  try {
    const [providerId, modelId] = ecom.modelKey ? ecom.modelKey.split(":") : ["", ""];
    const next = await ecommerceApi.saveConfig({
      matting: { provider: ecom.provider, endpoint: ecom.endpoint.trim(), ...(ecom.apiKey.trim() ? { apiKey: ecom.apiKey.trim() } : {}) },
      scene: { providerId, modelId },
      avatar: { provider: ecom.avatarProvider, endpoint: ecom.avatarEndpoint.trim(), ...(ecom.avatarKey.trim() ? { apiKey: ecom.avatarKey.trim() } : {}) },
    });
    ecomConfigured.value = next.matting.configured;
    avatarConfigured.value = next.avatar.configured;
    ecom.apiKey = "";
    ecom.avatarKey = "";
    ElMessage.success("电商配置已保存");
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "保存失败");
  } finally {
    ecomSaving.value = false;
  }
}

async function testMatting() {
  if (ecom.apiKey.trim()) {
    ElMessage.warning("请先保存配置，再测试连接");
    return;
  }
  testingMatting.value = true;
  try {
    const result = await ecommerceApi.testMatting();
    ElMessage.success(`抠图服务正常，耗时 ${result.latencyMs} ms`);
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "连接失败");
  } finally {
    testingMatting.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const next = await adminApi.saveSettings({ ...form });
    Object.assign(form, next);
    authState.system = { ...authState.system, ...next };
    await refreshAuth().catch(() => null);
    ElMessage.success("系统设置已保存");
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.settingsPage { display: flex; flex-direction: column; gap: 16px; max-width: 1040px; }
.panel { padding: 18px 20px; border: 1px solid var(--el-border-color-lighter); border-radius: 12px; background: var(--el-bg-color); }
.panelHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.panelHeader h3 { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
.panelHeader p { margin: 0; color: var(--el-text-color-placeholder); font-size: 11px; }
.settingsForm { max-width: 720px; }
.formGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.switchRow { display: flex; align-items: center; gap: 10px; height: 32px; }
.switchHint { color: var(--el-text-color-placeholder); font-size: 11px; }
.ecomHint { margin: 2px 0 0; color: var(--el-text-color-placeholder); font-size: 10.5px; line-height: 1.7; }
.primaryButton { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 13px; border: 0; border-radius: 8px; background: var(--el-color-primary); color: #fff; font-size: 12px; cursor: pointer; }
.primaryButton:disabled { opacity: 0.7; cursor: default; }
.panelActions { display: flex; align-items: center; gap: 8px; }
.testButton { height: 32px; padding: 0 12px; border: 1px solid var(--el-border-color); border-radius: 8px; background: transparent; color: var(--el-text-color-regular); font-size: 12px; cursor: pointer; }
.testButton:disabled { opacity: 0.6; cursor: default; }
.spinner { width: 12px; height: 12px; border: 2px solid rgba(255, 255, 255, 0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
.infoGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.infoItem { padding: 12px 14px; border-radius: 9px; background: var(--el-fill-color-lighter); }
.infoItem span { display: block; margin-bottom: 4px; color: var(--el-text-color-placeholder); font-size: 10.5px; }
.infoItem strong { display: block; overflow: hidden; font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.providerList { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.providerItem { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 9px; }
.providerIcon { display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 8px; background: rgba(143, 107, 255, 0.1); color: #7c5cff; }
.providerIcon.media { background: rgba(63, 191, 180, 0.12); color: #2f9e94; }
.providerIcon.account { background: rgba(224, 162, 74, 0.14); color: #c07c22; }
.providerCopy { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 1px; }
.providerCopy strong { overflow: hidden; font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.providerCopy span { color: var(--el-text-color-placeholder); font-size: 10px; }
.providerState { display: inline-flex; align-items: center; gap: 4px; color: var(--el-text-color-placeholder); font-size: 10.5px; white-space: nowrap; }
.providerState i { width: 5px; height: 5px; border-radius: 50%; background: #c2c8d2; }
.providerState.on { color: #2f9e94; }
.providerState.on i { background: #3fbfb4; }
.emptyText { margin: 0; padding: 20px 0; color: var(--el-text-color-placeholder); font-size: 12px; }
.securityNote { display: flex; gap: 11px; padding: 14px 16px; border: 1px solid rgba(224, 162, 74, 0.28); border-radius: 11px; background: rgba(224, 162, 74, 0.07); color: #a5691d; }
.securityNote strong { display: block; margin-bottom: 3px; font-size: 12px; }
.securityNote p { margin: 0; font-size: 11px; line-height: 1.7; opacity: 0.9; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) { .formGrid { grid-template-columns: 1fr; } }
</style>
