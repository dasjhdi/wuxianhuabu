<template>
  <section class="agentChat" aria-label="导演台 Agent">
    <header class="chatHead">
      <span class="chatTitle"><icon-sparkles :size="15" aria-hidden="true" />导演台 Agent</span>
      <el-select v-if="plans.length" :modelValue="selectedPlanId" class="planSelect" size="small" aria-label="当前方案" title="切换当前方案" @change="emit('selectPlan', $event)">
        <el-option v-for="plan in plans" :key="plan.id" :label="plan.name" :value="plan.id" />
      </el-select>
      <span v-if="running" class="chatState"><i class="pulse" aria-hidden="true" />{{ status || "生成中…" }}</span>
      <el-tooltip content="清空对话记录，场景与方案不受影响" placement="bottom" :showArrow="false">
        <button v-if="messages.length" class="clearButton" type="button" aria-label="清空对话" :disabled="running" title="清空对话" @click="emit('clear')"><icon-trash :size="13" /></button>
      </el-tooltip>
    </header>

    <div ref="listEl" class="chatList" @scroll="onScroll">
      <div v-if="!messages.length" class="chatEmpty">
        <div class="emptyIcon"><icon-sparkles :size="22" /></div>
        <p>描述场景、人物走位和运镜，我会直接搭建白模并给出镜头方案。</p>
        <div class="suggestions">
          <button type="button" @click="emit('recognize')">识别参考图并搭建</button>
          <button type="button" @click="emit('suggest', '让人物从画面右侧走到左侧，机位不动，时长 5 秒')">安排人物走位</button>
          <button type="button" @click="emit('suggest', '设计一个从全景缓慢推近到人物近景的镜头，时长 5 秒')">设计运镜</button>
        </div>
      </div>

      <div v-for="message in messages" :key="message.id" class="msgRow" :class="message.role">
        <span v-if="message.role === 'assistant'" class="avatar"><icon-sparkles :size="13" aria-hidden="true" /></span>
        <div class="bubble">
          <p v-if="message.text">{{ message.text }}</p>
          <span v-else-if="message.status === 'running'" class="typing" aria-label="正在生成"><i /><i /><i /></span>
          <div v-if="message.status === 'error'" class="msgState error">
            <icon-alert-triangle :size="13" />
            <span>{{ message.error || "生成失败" }}</span>
            <button v-if="message.instruction" type="button" @click="emit('retry', message.instruction)">重试</button>
          </div>
          <div v-else-if="message.status === 'stopped'" class="msgState">
            <icon-player-stop :size="12" /><span>已停止，场景未修改</span>
          </div>
          <div v-else-if="message.status === 'pending'" class="msgState pending">
            <icon-clock :size="12" /><span>等待确认应用</span>
          </div>
        </div>
      </div>

      <section v-if="pending" class="pendingCard" aria-label="待确认的生成结果">
        <img v-if="pending.thumb" :src="pending.thumb" alt="待确认场景预览" />
        <div class="pendingBody">
          <strong>{{ pending.title }}</strong>
          <p>{{ pending.detail }}</p>
          <div class="pendingActions">
            <el-button size="small" :disabled="applying" @click="emit('discard')">放弃</el-button>
            <el-button size="small" type="primary" :loading="applying" @click="emit('apply')">{{ applying ? "应用中…" : "应用到场景" }}</el-button>
          </div>
        </div>
      </section>
    </div>

    <footer class="chatComposer">
      <div class="composerInput"><slot name="input" /></div>
      <div class="composerBar">
        <el-tooltip content="开启后先生成草稿，确认后才写入场景" placement="top" :showArrow="false">
          <label class="confirmToggle">
            <el-switch :modelValue="confirmApply" size="small" @update:modelValue="emit('update:confirmApply', $event === true)" />
            <span>手动确认</span>
          </label>
        </el-tooltip>
        <el-select
          v-model="model"
          class="modelSelect"
          size="small"
          :loading="modelsLoading"
          filterable
          placeholder="选择模型"
          aria-label="生成模型"
          @visibleChange="$event && emit('loadModels')">
          <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
            <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
          </el-option-group>
        </el-select>
        <el-button
          v-if="running"
          class="sendButton stop"
          circle
          :icon="IconPlayerStop"
          aria-label="停止生成"
          title="停止生成，保留当前场景"
          @click="emit('stop')" />
        <el-button
          v-else
          class="sendButton"
          type="primary"
          circle
          :icon="IconArrowUp"
          :disabled="!prompt.trim() || !model || disabled"
          aria-label="发送指令"
          title="发送指令"
          @click="emit('send')" />
      </div>
      <p class="composerHint">助手按实际用量结算，生成画面等任务另行收费</p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElButton, ElOption, ElOptionGroup, ElSelect, ElSwitch, ElTooltip } from "element-plus";
import { IconAlertTriangle, IconArrowUp, IconClock, IconPlayerStop, IconSparkles, IconTrash } from "@tabler/icons-vue";
import type { NodeAiModel } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import type { AgentMessage, PendingApplyView } from "./agentTypes";

const props = defineProps<{
  messages: AgentMessage[];
  plans: { id: string; name: string }[];
  selectedPlanId?: string;
  running: boolean;
  status?: string;
  pending?: PendingApplyView | null;
  confirmApply: boolean;
  applying?: boolean;
  models: NodeAiModel[];
  modelsLoading: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  send: [];
  stop: [];
  apply: [];
  discard: [];
  retry: [instruction: string];
  clear: [];
  suggest: [text: string];
  recognize: [];
  selectPlan: [id: string];
  loadModels: [];
  "update:confirmApply": [value: boolean];
}>();
const prompt = defineModel<string>("prompt", { default: "" });
const model = defineModel<string>("model", { default: "" });
const listEl = ref<HTMLElement>();
const modelGroups = computed(() => groupNodeModels(props.models));
const stickToBottom = ref(true);

// ACT: 只在用户已经在底部时跟随流式输出；向上翻看历史时不再强行拉回底部。
function onScroll() {
  const element = listEl.value;
  if (!element) return;
  stickToBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
}
const textLength = computed(() => props.messages.reduce((total, message) => total + message.text.length, 0));
watch(() => props.messages.length, () => { stickToBottom.value = true; });
watch([textLength, () => props.running, () => props.pending], async () => {
  if (!stickToBottom.value) return;
  await nextTick();
  const element = listEl.value;
  if (element) element.scrollTop = element.scrollHeight;
}, { immediate: true });
</script>

<style scoped lang="scss">
.agentChat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  color: var(--el-text-color-primary);

  .chatHead {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    padding: 2px 2px 8px;
    .chatTitle { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; white-space: nowrap; }
    .planSelect { flex: 1; min-width: 0; max-width: 132px; margin-left: auto; }
    .chatState {
      display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
      color: var(--el-color-primary); font-size: 11px; white-space: nowrap;
      .pulse { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: agentPulse 1.1s ease-in-out infinite; }
    }
    .clearButton {
      display: grid; place-items: center; flex-shrink: 0;
      width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px;
      background: transparent; color: var(--el-text-color-placeholder); cursor: pointer;
      &:hover { background: var(--el-fill-color); color: var(--el-text-color-regular); }
    }
  }

  .chatList {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 2px 10px;
  }

  .chatEmpty {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    margin: auto 6px; padding: 18px 12px; text-align: center; color: var(--el-text-color-secondary);
    .emptyIcon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 12%, transparent); }
    p { margin: 0; font-size: 12px; line-height: 1.7; }
    .suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 2px;
      button { padding: 5px 10px; border: 1px solid var(--el-border-color); border-radius: 999px; background: var(--el-bg-color); color: var(--el-text-color-regular); font-size: 11px; cursor: pointer;
        &:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); } }
    }
  }

  .msgRow {
    display: flex; align-items: flex-start; gap: 8px;
    &.user { justify-content: flex-end; }
    .avatar { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; border-radius: 8px; color: #fff; background: linear-gradient(135deg, #6366f1, #8b5cf6); }
    .bubble {
      max-width: 84%; min-width: 0; padding: 9px 11px; border-radius: 12px;
      background: var(--el-fill-color-light); font-size: 12px; line-height: 1.7;
      p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
    }
    &.user .bubble { background: color-mix(in srgb, var(--el-color-primary) 14%, transparent); border-bottom-right-radius: 4px; }
    &.assistant .bubble { border-bottom-left-radius: 4px; }
  }

  .typing { display: inline-flex; gap: 4px; padding: 2px 0;
    i { width: 5px; height: 5px; border-radius: 50%; background: var(--el-text-color-placeholder); animation: agentTyping 1.1s ease-in-out infinite;
      &:nth-child(2) { animation-delay: 0.15s; } &:nth-child(3) { animation-delay: 0.3s; } } }

  .msgState {
    display: flex; align-items: center; gap: 5px; margin-top: 6px;
    color: var(--el-text-color-secondary); font-size: 11px;
    &.error { color: var(--el-color-danger); flex-wrap: wrap; }
    &.pending { color: var(--el-color-warning); }
    button { padding: 0; border: 0; background: transparent; color: var(--el-color-primary); font-size: 11px; cursor: pointer; text-decoration: underline; }
  }

  .pendingCard {
    display: flex; gap: 10px; padding: 10px; border: 1px solid color-mix(in srgb, var(--el-color-primary) 35%, var(--el-border-color));
    border-radius: 12px; background: color-mix(in srgb, var(--el-color-primary) 6%, var(--el-bg-color));
    img { width: 86px; height: 54px; object-fit: cover; border-radius: 6px; flex-shrink: 0; background: #000; }
    .pendingBody { flex: 1; min-width: 0;
      strong { display: block; font-size: 12px; }
      p { margin: 4px 0 8px; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
      .pendingActions { display: flex; justify-content: flex-end; gap: 6px; .el-button { margin: 0; } }
    }
  }

  .chatComposer {
    flex-shrink: 0;
    margin-top: 4px;
    padding: 8px;
    border: 1px solid var(--el-border-color-light);
    border-radius: 12px;
    background: var(--el-bg-color);
    &:focus-within { border-color: var(--el-color-primary-light-5); }
    .composerInput {
      min-width: 0;
      :deep(.referenceList) { margin-bottom: 6px; }
      :deep(.chat-rich-text > [contenteditable]) { min-height: 42px; }
    }
    .composerBar { display: flex; align-items: center; gap: 6px; margin-top: 6px;
      .confirmToggle { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; color: var(--el-text-color-secondary); font-size: 11px; cursor: pointer; white-space: nowrap; }
      .modelSelect { flex: 1; min-width: 0;
        :deep(.el-select__wrapper) { background: transparent; box-shadow: none; }
      }
      .sendButton { flex-shrink: 0; margin: 0; }
      .sendButton.stop { color: var(--el-color-danger); border-color: var(--el-color-danger-light-5); }
    }
    .composerHint { margin: 6px 0 0; color: var(--el-text-color-placeholder); font-size: 10px; line-height: 1.4; }
  }
}

@keyframes agentPulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@keyframes agentTyping { 0%, 100% { transform: translateY(0); opacity: 0.45; } 50% { transform: translateY(-3px); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .agentChat .chatState .pulse { animation: none; }
  .agentChat .typing i { animation: none; }
}
</style>
