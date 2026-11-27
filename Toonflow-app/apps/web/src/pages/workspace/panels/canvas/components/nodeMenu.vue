<template>
  <selectionHandle
    v-if="!singleGroupSelected"
    ref="selectionHandleRef"
    @start="startSelectionConnection"
    @release="(event, nodes) => openMenu(event, true, [], undefined, nodes)" />
  <selectionHandle
    v-for="group in groups"
    :key="group.id"
    ref="groupHandleRefs"
    :nodes="[group]"
    @start="startSelectionConnection"
    @release="(event, nodes) => openMenu(event, true, [], undefined, nodes)" />
  <el-dropdown
    ref="menu"
    trigger="contextmenu"
    virtualTriggering
    :virtualRef="menuAnchor"
    placement="bottom-start"
    :popperOptions="{ strategy: 'fixed', modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 8 } }] }"
    :showArrow="false"
    :showTimeout="0"
    :hideTimeout="0"
    :hideOnClick="false"
    @command="handleCommand"
    @visibleChange="onMenuVisibleChange">
    <template #dropdown>
      <el-dropdown-menu
        ref="menuList"
        class="nodeMenu"
        @focus.self="menuLevel === 'nodes' && nodeMenuItemsRef?.focusFirst()"
        :aria-label="menuLevel === 'selection' ? '选区操作' : menuLevel === 'actions' ? '操作菜单' : '添加节点'">
        <template v-if="menuLevel === 'selection'">
          <el-dropdown-item command="duplicateSelection" :icon="IconCopyPlus" :disabled="selectionBusy || deleting || !selectedNodes.length">
            创建副本
          </el-dropdown-item>
          <el-dropdown-item
            command="arrange"
            :icon="IconLayoutGrid"
            :disabled="!canArrangeSelection"
            data-flyout="arrange"
            @mouseenter="hoverExpand('arrange')"
            @mouseleave="onTriggerLeave">
            <span>整理选中节点</span>
            <icon-chevron-right class="nextIcon" :size="14" />
          </el-dropdown-item>
          <el-dropdown-item
            command="deleteSelection"
            :icon="IconTrash"
            :disabled="selectionBusy || deleting || !selectedNodes.some((node) => node.deletable !== false)">
            {{ deleting ? "删除中…" : `删除选中节点（${selectedNodes.length}）` }}
          </el-dropdown-item>
        </template>
        <template v-else-if="menuLevel === 'actions'">
          <el-dropdown-item command="upload" :icon="IconUpload" :disabled="!uploadFiles">上传</el-dropdown-item>
          <el-dropdown-item
            command="nodes"
            :icon="IconPlus"
            data-flyout="nodes"
            @mouseenter="hoverExpand('nodes')"
            @mouseleave="onTriggerLeave">
            <span>添加节点</span>
            <icon-chevron-right class="nextIcon" :size="14" />
          </el-dropdown-item>
          <el-divider />
          <el-dropdown-item command="undo" :icon="IconArrowBackUp" :disabled="!canUndo">撤销</el-dropdown-item>
          <el-dropdown-item command="redo" :icon="IconArrowForwardUp" :disabled="!canRedo">重做</el-dropdown-item>
          <el-divider />
          <el-dropdown-item command="paste" :icon="IconClipboard" :disabled="!pasteNode || pasting">
            {{ pasting ? "粘贴中…" : "粘贴" }}
          </el-dropdown-item>
        </template>
        <template v-else>
          <el-dropdown-item disabled>添加节点</el-dropdown-item>
          <el-dropdown-item v-if="!menuItems.length" disabled>{{ pendingHandle || pendingGroup.length ? "没有可连接的节点" : "没有可显示的节点" }}</el-dropdown-item>
          <nodeMenuItems
            v-if="menuVisible"
            ref="nodeMenuItemsRef"
            :items="menuItems"
            :nodes="filteredNodes"
            :appendTo="menuContainer"
            :uploadDisabled="!uploadFiles"
            @select="handleCommand"
            @upload="handleCommand('upload')"
            @close="menu?.handleClose()" />
        </template>
      </el-dropdown-menu>
      <!-- ACT: 子面板挂在 dropdown popper 容器内而非 body——tooltip 的 onClickOutside 会把容器外的点击
           当成外部点击提前关闭整个菜单；挂进容器后既躲开判定，也脱离 el-scrollbar 的 overflow 裁剪。 -->
      <Teleport v-if="menuContainer" :to="menuContainer">
        <div
          v-if="flyoutVisible"
          ref="flyoutRef"
          class="nodeFlyout"
          :class="flyoutSide === 'left' ? 'is-left' : 'is-right'"
          :style="flyoutStyle"
          role="menu"
          :aria-label="flyoutKind === 'arrange' ? '整理选中节点' : '添加节点'"
          @mouseenter="cancelFlyoutClose"
          @mouseleave="scheduleFlyoutClose">
          <nodeMenuItems
            v-if="flyoutKind === 'nodes'"
            ref="nodeMenuItemsRef"
            :items="menuItems"
            :nodes="filteredNodes"
            :appendTo="menuContainer"
            :uploadDisabled="!uploadFiles"
            @select="handleCommand"
            @upload="handleCommand('upload')"
            @close="menu?.handleClose()" />
          <template v-else>
            <button type="button" class="flyoutItem" role="menuitem" :disabled="!canArrangeSelection" @click="handleCommand('horizontal')">
              <icon-layout-columns :size="14" aria-hidden="true" />
              <span>水平排列</span>
            </button>
            <button type="button" class="flyoutItem" role="menuitem" :disabled="!canArrangeSelection" @click="handleCommand('vertical')">
              <icon-layout-rows :size="14" aria-hidden="true" />
              <span>垂直排列</span>
            </button>
            <button type="button" class="flyoutItem" role="menuitem" :disabled="!canArrangeSelection" @click="handleCommand('grid')">
              <icon-layout-grid :size="14" aria-hidden="true" />
              <span>宫格排列</span>
            </button>
          </template>
        </div>
      </Teleport>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type Component } from "vue";
import { useVueFlow, type ConnectingHandle, type GraphNode, type HandleType } from "@vue-flow/core";
import { isTypeCompatible, useNodeEvent, validateConnection, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { ElMessage } from "element-plus";
import type { DropdownInstance } from "element-plus";
import selectionHandle from "./selectionHandle.vue";
import nodeMenuItems from "./nodeMenuItems.vue";
import { generalSettings } from "@/stores/settings";
import { filterNodeMenu, resolveNodeMenu } from "@toonflow/server/nodeMenu";
import { getSelectionConnections } from "../selectionConnections";
import { getSelectionRoots, getSelectionTree } from "../selectionNodes";
import { arrangeSelection } from "../arrangeSelection";
import {
  IconClipboard,
  IconCopyPlus,
  IconTrash,
  IconBox,
  IconUpload,
  IconPlus,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronRight,
  IconLayoutColumns,
  IconLayoutRows,
  IconLayoutGrid,
} from "@tabler/icons-vue";

const { remoteNodes = [], disabled = false, pasteNode, uploadFiles, canUndo = false, canRedo = false, selectionBusy = false, batchHistory } = defineProps<{
  remoteNodes?: { type: string; label: string }[];
  disabled?: boolean;
  pasteNode?: (position: { x: number; y: number }) => Promise<boolean>;
  uploadFiles?: (position: { x: number; y: number }) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  selectionBusy?: boolean;
  batchHistory?: (action: () => Promise<void>) => Promise<void>;
}>();
const emit = defineEmits<{ history: []; undo: []; redo: []; duplicateSelection: [] }>();
const menu = ref<DropdownInstance>();
const menuList = ref<{ $el: HTMLElement }>();
const menuVisible = ref(false);
const nodeMenuItemsRef = ref<InstanceType<typeof nodeMenuItems>>();
const menuContainer = computed(() => menuList.value?.$el.closest<HTMLElement>(".el-dropdown__popper") ?? undefined);
const menuLevel = ref<"actions" | "nodes" | "selection" | "arrange">("actions");
const selectedNodes = shallowRef<GraphNode[]>([]);
const deleting = ref(false);
const pasting = ref(false);
const menuAnchor = shallowRef({ getBoundingClientRect: () => new DOMRect() });
const flow = useVueFlow();
const { addNodes, screenToFlowCoordinate, onPaneContextMenu, onSelectionContextMenu, onPaneClick, onMoveStart } = flow;
let nodePosition = { x: 0, y: 0 };
type DraggedHandle = { node: GraphNode; id: string; type: HandleType; start: ConnectingHandle };
const pendingHandle = shallowRef<DraggedHandle>();
const pendingGroup = shallowRef<GraphNode[]>([]);
const selectionHandleRef = ref<InstanceType<typeof selectionHandle>>();
const groupHandleRefs = ref<InstanceType<typeof selectionHandle>[]>([]);
const groups = computed(() => flow.getNodes.value.filter(node => node.type === "canvasGroup" && !node.hidden));
const singleGroupSelected = computed(() => flow.getSelectedNodes.value.length === 1 && flow.getSelectedNodes.value[0]?.type === "canvasGroup");
const canArrangeSelection = computed(() => {
  const nodes = getSelectionRoots(selectedNodes.value, flow.getNodes.value);
  return !selectionBusy && !deleting.value && nodes.length > 1
    && nodes.every(node => flow.findNode(node.id) === node && node.draggable !== false
      && Number.isFinite(node.dimensions.width) && node.dimensions.width > 0
      && Number.isFinite(node.dimensions.height) && node.dimensions.height > 0);
});
const filteredNodes = computed(() => {
  const nodes = remoteNodes.map(node => ({
    ...node,
    icon: (flow.nodeTypes?.value?.[node.type] as { icon?: Component } | undefined)?.icon ?? IconBox,
  }));
  if (pendingGroup.value.length) {
    if (!flow.nodesConnectable.value || pendingGroup.value.some(node => flow.findNode(node.id) !== node || node.connectable === false)) return [];
    return nodes.filter(node => {
      const targets = (flow.nodeTypes?.value?.[node.type] as { handles?: NodeHandle[] } | undefined)?.handles?.filter(handle => handle.type === "target") ?? [];
      return pendingGroup.value.every(source => (source.data.handles as NodeHandle[] | undefined)?.some(output =>
        output.type === "source" && targets.some(input => isTypeCompatible(output.dataType, input.dataType))));
    });
  }
  const handle = pendingHandle.value;
  if (!handle) return nodes;
  if (flow.findNode(handle.node.id) !== handle.node || !flow.nodesConnectable.value || handle.node.connectable === false) return [];
  const port = (handle.node.data.handles as NodeHandle[] | undefined)?.find((item) => item.id === handle.id && item.type === handle.type);
  if (!port) return [];
  return nodes.filter((node) => {
    const handles = (flow.nodeTypes?.value?.[node.type] as { handles?: NodeHandle[] } | undefined)?.handles;
    return handles?.some((item) => item.type !== port.type && isTypeCompatible(port.dataType, item.dataType));
  });
});

const menuItems = computed(() => filterNodeMenu(
  resolveNodeMenu(generalSettings.value.nodeMenu, remoteNodes),
  new Set(filteredNodes.value.map(node => node.type)),
));

async function onMenuVisibleChange(visible: boolean) {
  menuVisible.value = visible;
  closeFlyout();
  if (!visible) return clearConnection();
  await nextTick();
  if (menuLevel.value === "nodes") nodeMenuItemsRef.value?.focusFirst();
}

// ACT: 悬浮「添加节点 / 整理选中节点」稍作停留即在主菜单旁边弹出独立子面板，主菜单保持不动；
// 从相邻项划过时停留不足延迟不会误触，点击则立即弹出。离开触发项或子面板后延迟收起。
const hoverExpandDelay = 180;
const flyoutCloseDelay = 150;
let hoverExpandTimer: ReturnType<typeof setTimeout> | undefined;
let flyoutCloseTimer: ReturnType<typeof setTimeout> | undefined;
const flyoutVisible = ref(false);
const flyoutKind = ref<"nodes" | "arrange">("nodes");
const flyoutSide = ref<"left" | "right">("right");
const flyoutRef = ref<HTMLElement>();
const flyoutStyle = ref<{ [key: string]: string }>({});

function cancelHoverExpand() {
  if (hoverExpandTimer === undefined) return;
  clearTimeout(hoverExpandTimer);
  hoverExpandTimer = undefined;
}

function cancelFlyoutClose() {
  if (flyoutCloseTimer === undefined) return;
  clearTimeout(flyoutCloseTimer);
  flyoutCloseTimer = undefined;
}

function closeFlyout() {
  cancelHoverExpand();
  cancelFlyoutClose();
  flyoutVisible.value = false;
}

function scheduleFlyoutClose() {
  cancelFlyoutClose();
  flyoutCloseTimer = setTimeout(() => {
    flyoutCloseTimer = undefined;
    closeFlyout();
  }, flyoutCloseDelay);
}

function hoverExpand(kind: "nodes" | "arrange") {
  if (disabled || (kind === "arrange" && !canArrangeSelection.value)) return;
  if (flyoutVisible.value && flyoutKind.value === kind) {
    cancelHoverExpand();
    cancelFlyoutClose();
    return;
  }
  cancelHoverExpand();
  hoverExpandTimer = setTimeout(() => {
    hoverExpandTimer = undefined;
    openFlyout(kind);
  }, hoverExpandDelay);
}

function onTriggerLeave() {
  cancelHoverExpand();
  if (flyoutVisible.value) scheduleFlyoutClose();
}

function openFlyout(kind: "nodes" | "arrange", focus = false) {
  if (disabled || !menuVisible.value) return;
  if (kind === "arrange" && !canArrangeSelection.value) return;
  const trigger = menuList.value?.$el.querySelector<HTMLElement>(`[data-flyout="${kind}"]`);
  const popper = menuList.value?.$el.closest<HTMLElement>(".el-popper");
  if (!trigger || !popper) return;
  cancelHoverExpand();
  cancelFlyoutClose();
  const popperRect = popper.getBoundingClientRect();
  const rect = trigger.getBoundingClientRect();
  // 宽度用估算值即可：右侧空间不足时翻转到菜单左侧弹出。
  const width = kind === "nodes" ? 210 : 160;
  const openLeft = rect.right + 4 + width > window.innerWidth - 8 && rect.left - 4 - width >= 8;
  flyoutSide.value = openLeft ? "left" : "right";
  const side = openLeft
    ? { left: "auto", right: `${popperRect.right - rect.left + 4}px` }
    : { left: `${rect.right - popperRect.left + 4}px`, right: "auto" };
  flyoutKind.value = kind;
  flyoutStyle.value = { ...side, top: `${rect.top - popperRect.top - 5}px` };
  flyoutVisible.value = true;
  void nextTick().then(() => {
    const el = flyoutRef.value;
    if (!el || !flyoutVisible.value) return;
    // 垂直方向夹在视口内，节点列表较高时不溢出屏幕底部。
    let top = rect.top - 5;
    top = Math.min(top, window.innerHeight - 8 - el.offsetHeight);
    top = Math.max(top, 8);
    flyoutStyle.value = { ...flyoutStyle.value, top: `${top - popperRect.top}px` };
    if (focus) {
      if (kind === "nodes") nodeMenuItemsRef.value?.focusFirst(true);
      else el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
  });
}

function clearSelectionHandles() {
  selectionHandleRef.value?.clear();
  groupHandleRefs.value.forEach(handle => handle.clear());
}

function clearConnection() {
  if (pendingHandle.value) {
    pendingHandle.value = undefined;
    flow.endConnection();
  }
  if (pendingGroup.value.length) {
    pendingGroup.value = [];
    clearSelectionHandles();
  }
}

function startSelectionConnection() {
  clearConnection();
  clearSelectionHandles();
  menu.value?.handleClose();
}

onBeforeUnmount(() => {
  closeFlyout();
  clearConnection();
});
watch(() => disabled, value => {
  if (!value) return;
  menu.value?.handleClose();
  closeFlyout();
  clearConnection();
});
flow.onConnectStart(() => {
  pendingHandle.value = undefined;
  clearConnection();
  menu.value?.handleClose();
});

flow.onConnectEnd((event) => {
  const handle = flow.connectionStartHandle.value;
  if (!handle || flow.connectionStatus.value === "valid" || !event || event.type === "touchcancel") return;
  const node = flow.findNode(handle.nodeId);
  if (!node || handle.id == null) return;
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  if (!point) return;
  const target = document.elementFromPoint(point.clientX, point.clientY);
  if (!target?.classList.contains("vue-flow__pane") || !flow.vueFlowRef.value?.contains(target)) return;
  void openMenu(event, true, [], { node, id: handle.id, type: handle.type, start: { ...handle } });
});

async function openMenu(event: MouseEvent | TouchEvent, nodesOnly = false, selection: GraphNode[] = [], handle?: DraggedHandle, group: GraphNode[] = []) {
  event.preventDefault();
  event.stopPropagation();
  if (disabled) return;
  emit("history");
  cancelHoverExpand();
  menu.value?.handleClose();
  closeFlyout();
  clearConnection();
  await nextTick();
  if (disabled || !menu.value || (handle && flow.findNode(handle.node.id) !== handle.node)) return;
  pendingHandle.value = handle;
  pendingGroup.value = group;
  selectedNodes.value = [...selection];
  menuLevel.value = selection.length ? "selection" : nodesOnly ? "nodes" : "actions";
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  if (!point) return;
  const { clientX, clientY } = point;
  nodePosition = screenToFlowCoordinate({ x: clientX, y: clientY });
  menuAnchor.value = { getBoundingClientRect: () => new DOMRect(clientX, clientY, 0, 0) };
  if (handle) {
    const bounds = flow.vueFlowRef.value!.getBoundingClientRect();
    // ACT: VueFlow 在释放后清空拖线；菜单期间复用其预览，避免创建临时节点或边。
    flow.startConnection(handle.start, { x: clientX - bounds.left, y: clientY - bounds.top });
  }
  await nextTick();
  if (!disabled) menu.value?.handleOpen();
}

onPaneContextMenu(openMenu);
onSelectionContextMenu(({ event, nodes }) => openMenu(event, false, nodes));
onPaneClick(() => menu.value?.handleClose());
onMoveStart(() => menu.value?.handleClose());
flow.onNodeContextMenu(() => {
  clearConnection();
  menu.value?.handleClose();
});
defineExpose({ openMenu, deleteSelection, addNode });

async function addNode(type: string, position: { x: number; y: number }) {
  clearConnection();
  emit("history");
  nodePosition = { ...position };
  await handleCommand(type);
}

async function handleCommand(command: unknown) {
  if (disabled) return;
  cancelHoverExpand();
  if (command === "nodes" || command === "arrange") {
    openFlyout(command, true);
    return;
  }
  if (command === "duplicateSelection") {
    if (selectionBusy || deleting.value || !selectedNodes.value.length) return;
    menu.value?.handleClose();
    emit("duplicateSelection");
    return;
  }
  if (command === "upload") {
    menu.value?.handleClose();
    uploadFiles?.({ ...nodePosition });
    return;
  }
  if (command === "undo" || command === "redo") {
    if (command === "undo" ? !canUndo : !canRedo) return;
    menu.value?.handleClose();
    if (command === "undo") emit("undo");
    else emit("redo");
    return;
  }
  if (batchHistory) {
    try {
      await batchHistory(() => runCommand(command));
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "画布操作失败");
    }
    return;
  }
  await runCommand(command);
}

async function runCommand(command: unknown) {
  if (command === "horizontal" || command === "vertical" || command === "grid") {
    if (!canArrangeSelection.value) return;
    arrangeSelection(flow, selectedNodes.value, command);
    menu.value?.handleClose();
    return;
  }
  if (command === "paste") {
    if (!pasteNode || pasting.value) return;
    pasting.value = true;
    try {
      if (await pasteNode({ ...nodePosition })) menu.value?.handleClose();
    } finally {
      pasting.value = false;
    }
    return;
  }
  if (command === "deleteSelection") {
    await deleteSelection();
    return;
  }
  const node = filteredNodes.value.find((option) => option.type === command);
  if (!node) return;
  const handle = pendingHandle.value;
  const group = pendingGroup.value;
  if (handle && flow.findNode(handle.node.id) !== handle.node) return;
  if (group.some(source => flow.findNode(source.id) !== source)) return;
  const id = crypto.randomUUID();
  addNodes({ id, type: node.type, position: { ...nodePosition }, data: { label: node.label } });
  if (!handle && !group.length) {
    flow.removeSelectedElements();
    flow.nodesSelectionActive.value = false;
    const created = flow.findNode(id);
    if (created) flow.addSelectedNodes([created]);
    return menu.value?.handleClose();
  }
  // ACT: 远端节点挂载后才注册端口，沿用画布工具的 nextTick 等待方式。
  await nextTick();
  const created = flow.findNode(id);
  if (group.length) {
    if (!created) return;
    const connections = flow.nodesConnectable.value
      ? getSelectionConnections(group, created, flow.getNodes.value, flow.getEdges.value)
      : undefined;
    if (connections) {
      flow.addEdges(connections);
      flow.removeSelectedElements();
      flow.nodesSelectionActive.value = false;
      clearConnection();
      menu.value?.handleClose();
    } else {
      flow.removeNodes(id, true);
      flow.removeSelectedElements();
      flow.addSelectedNodes(group);
      flow.nodesSelectionActive.value = true;
      ElMessage.warning("目标节点的接收规则不允许整组连接，请尝试分别连接。");
    }
    return;
  }
  if (!handle) return;
  if (!created || flow.findNode(handle.node.id) !== handle.node) {
    clearConnection();
    return menu.value?.handleClose();
  }
  const sourceNode = handle.type === "source" ? handle.node : created;
  const targetNode = handle.type === "target" ? handle.node : created;
  const connection = (created.data.handles as NodeHandle[] | undefined)
    ?.filter((item) => item.type !== handle.type)
    .map((item) => ({
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: handle.type === "source" ? handle.id : item.id,
      targetHandle: handle.type === "target" ? handle.id : item.id,
    }))
    .find(
      (item) =>
        flow.nodesConnectable.value &&
        sourceNode.connectable !== false &&
        targetNode.connectable !== false &&
        validateConnection(item, { sourceNode, targetNode, nodes: flow.getNodes.value, edges: flow.getEdges.value })
    );
  if (connection) flow.addEdges(connection);
  else ElMessage.warning("节点已创建，但没有兼容的端口可连接。");
  clearConnection();
  menu.value?.handleClose();
}

async function deleteSelection(selection = selectedNodes.value) {
  if (selectionBusy || deleting.value) return;
  const nodes = getSelectionTree(selection.filter(node => node.deletable !== false), flow.getNodes.value).reverse();
  const nodeIds = new Set(nodes.filter(node => node.deletable !== false).map(node => node.id));
  deleting.value = true;
  try {
    for (const node of nodes) {
      if (node.deletable === false || flow.findNode(node.id) !== node) continue;
      if (flow.getNodes.value.some(item => item.parentNode === node.id && !nodeIds.has(item.id))) throw new Error("分组中存在不可删除的节点");
      if (flow.getConnectedEdges(node.id).some((edge) => edge.deletable === false)) throw new Error("节点存在不可删除的连接");
    }
    for (const node of nodes) {
      if (node.deletable === false || flow.findNode(node.id) !== node) continue;
      await useNodeEvent(node.id, flow).emit("delete");
      if (flow.getNodes.value.some(item => item.parentNode === node.id)) throw new Error("分组内容已变化，请重新删除");
      if (flow.findNode(node.id) === node) flow.removeNodes(node.id, true);
    }
    menu.value?.handleClose();
  } catch (error) {
    const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    ElMessage.error(message || (error instanceof Error ? error.message : "删除选中节点失败"));
  } finally {
    selectedNodes.value = selectedNodes.value.filter((node) => flow.findNode(node.id) === node);
    deleting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.nodeMenu {
  min-width: 180px;

  :deep(.el-divider--horizontal) {
    margin: 4px 0;
  }

  .nextIcon {
    margin-left: auto;
  }
}

.nodeFlyout {
  position: absolute;
  z-index: 1;
  min-width: 180px;
  padding: 5px 0;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  box-shadow: var(--el-box-shadow-light);

  // ACT: 朝向主菜单一侧的隐形桥接条，覆盖缝隙避免跨过去的瞬间触发收起。
  &::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
  }

  &.is-right::before {
    left: -8px;
  }

  &.is-left::before {
    right: -8px;
  }
}

.flyoutItem {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 150px;
  margin: 0;
  border: 0;
  border-radius: 0;
  padding: 5px 16px;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--el-font-size-base);
  line-height: 22px;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    outline: none;
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }

  &:disabled {
    background: transparent;
    color: var(--el-text-color-disabled);
    cursor: not-allowed;
  }
}
</style>
