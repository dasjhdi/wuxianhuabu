<template>
  <el-dropdown
    ref="dropdown"
    class="addNodePicker"
    trigger="hover"
    placement="top-start"
    :show-timeout="80"
    :hide-timeout="220"
    :disabled="disabled"
    :teleported="true"
    popper-class="addNodePickerPopper"
    @command="onCommand">
    <span class="addNodeTrigger" @click="openPicker"><slot /></span>
    <template #dropdown>
      <el-dropdown-menu class="addNodeMenu" aria-label="添加节点">
        <li class="addNodeTitle" role="presentation">
          <span>添加节点</span>
          <small>{{ nodeCount }}</small>
        </li>
        <template v-for="entry in entries" :key="entry.id">
          <li v-if="entry.kind === 'group'" class="addNodeGroup" role="presentation">{{ entry.label }}</li>
          <el-dropdown-item v-else :command="entry.type">
            <component :is="iconOf(entry.type)" class="addNodeIcon" :size="15" aria-hidden="true" />
            <span class="addNodeLabel">{{ entry.label }}</span>
          </el-dropdown-item>
        </template>
        <el-dropdown-item v-if="!entries.length" disabled>暂无可添加的节点</el-dropdown-item>
        <el-divider />
        <el-dropdown-item command="upload">
          <icon-upload class="addNodeIcon" :size="15" aria-hidden="true" />
          <span class="addNodeLabel">上传</span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from "vue";
import type { DropdownInstance } from "element-plus";
import { IconBox, IconUpload } from "@tabler/icons-vue";
import { generalSettings } from "@/stores/settings";
import { filterNodeMenu, resolveNodeMenu, type NodeMenuItem } from "@toonflow/server/nodeMenu";

const props = withDefaults(defineProps<{
  nodes: { type: string; label: string; icon?: Component }[];
  disabled?: boolean;
}>(), { disabled: false });
const emit = defineEmits<{ select: [type: string]; upload: [] }>();

const dropdown = ref<DropdownInstance>();
type Entry = { kind: "group"; id: string; label: string } | { kind: "node"; id: string; type: string; label: string };

// ACT: 与画布右键菜单共用同一份 nodeMenu 配置（分组、别名、隐藏），悬浮菜单里看到的顺序和右键一致。
const entries = computed<Entry[]>(() => {
  const installed = new Set(props.nodes.map(node => node.type));
  const menu: NodeMenuItem[] = filterNodeMenu(resolveNodeMenu(generalSettings.value.nodeMenu, props.nodes.map(({ type, label }) => ({ type, label }))), installed);
  const output: Entry[] = [];
  for (const item of menu) {
    if (item.type) {
      output.push({ kind: "node", id: item.id, type: item.type, label: item.label });
      continue;
    }
    output.push({ kind: "group", id: item.id, label: item.label });
    for (const child of item.children ?? []) {
      if (child.type) output.push({ kind: "node", id: child.id, type: child.type, label: child.label });
    }
  }
  return output;
});
const nodeCount = computed(() => entries.value.filter(entry => entry.kind === "node").length);
const icons = computed(() => new Map(props.nodes.map(node => [node.type, node.icon])));
function iconOf(type: string) {
  return icons.value.get(type) ?? IconBox;
}
function onCommand(command: string) {
  if (command === "upload") emit("upload");
  else emit("select", command);
}
// 悬停已经会展开；点击作为键盘/触屏的兜底，不会改变鼠标用户的操作习惯。
function openPicker() {
  if (props.disabled) return;
  dropdown.value?.handleOpen();
}
</script>

<style scoped lang="scss">
.addNodePicker { display: inline-flex; }
.addNodeTrigger { display: inline-flex; }
</style>

<style lang="scss">
.addNodePickerPopper {
  .el-dropdown-menu {
    min-width: 176px;
    max-height: min(62vh, 540px);
    overflow-y: auto;
    padding: 5px 0;
  }
  .addNodeTitle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 12px 6px;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    small { color: var(--el-text-color-placeholder); font-variant-numeric: tabular-nums; }
  }
  .addNodeGroup {
    padding: 4px 12px 2px;
    color: var(--el-text-color-secondary);
    font-size: 11px;
  }
  .el-dropdown-menu__item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .addNodeIcon { flex: none; color: var(--el-text-color-secondary); }
  .addNodeLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
</style>
