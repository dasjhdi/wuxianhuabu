<template>
  <el-dialog
    class="directorDialog"
    title="3D 导演台"
    :modelValue="visible"
    fullscreen
    alignCenter
    appendToBody
    :closeOnClickModal="false"
    :closeOnPressEscape="false"
    :beforeClose="closeEditor"
    @opened="loadScene()"
    @closed="emit('close')">
    <template #header>
      <div class="directorHeader">
        <icon-cube3d-sphere :size="20" />
        <span>3D 导演台</span>
        <small class="headerSub">搭景 · 走位 · 运镜预演</small>
        <small v-if="result">{{ result.name }}</small>
        <span class="headerSpacer" />
        <el-button size="small" text :icon="IconArrowBackUp" :disabled="!canUndo" title="撤销 (Ctrl+Z)" aria-label="撤销" @click="emit('undo')" />
        <el-button size="small" text :icon="IconArrowForwardUp" :disabled="!canRedo" title="重做 (Ctrl+Shift+Z)" aria-label="重做" @click="emit('redo')" />
        <span class="headerStat">{{ scene.objectList.length }} 物体 · {{ anchors.length }} 机位 · {{ plans.length }} 方案</span>
        <el-button size="small" text :icon="IconDeviceFloppy" :disabled="!ready" @click="emit('save')">保存场景</el-button>
        <el-button size="small" text :icon="IconSparkles" :class="{ activeButton: aiPanelOpen }" @click="toggleAiPanel">导演台 Agent</el-button>
      </div>
    </template>
    <input ref="modelInput" type="file" accept=".glb,.gltf" hidden aria-label="上传模型文件" @change="onModelSelect" />
    <div class="directorWorkspace" :class="{ withAi: aiPanelOpen, libraryOpen }">
      <aside class="toolRail" aria-label="导演台工具">
        <button class="railButton libraryToggle" type="button" title="展开 / 收起素材库" :class="{ active: libraryOpen }" @click="libraryOpen = !libraryOpen">
          <icon-layout-sidebar :size="18" />
        </button>
        <button class="railButton" type="button" title="上传 GLB 模型" :disabled="!ready || uploadingModel" @click="replaceObjectId = ''; modelInput?.click()">
          <icon-upload :size="18" />
        </button>
        <el-popover trigger="click" placement="right-start" :width="220" :ref="el => setRailRef('pose', el)">
          <template #reference>
            <button class="railButton" type="button" title="添加人偶" :disabled="!ready || addingMannequin" @click="showRail('pose')">
              <icon-user-plus :size="18" />
            </button>
          </template>
          <div class="railPanel">
            <div class="panelTitle">添加人偶</div>
            <el-select v-model="addPose" size="small" aria-label="人偶姿势">
              <el-option v-for="preset in posePresets" :key="preset.name" :label="preset.name" :value="preset.name" />
            </el-select>
            <el-button size="small" type="primary" :loading="addingMannequin" :disabled="!ready || addingMannequin" @click="emit('addMannequin', { pose: addPose, preset: addPreset })">添加人偶</el-button>
          </div>
        </el-popover>
        <el-popover trigger="click" placement="right-start" :width="180" :ref="el => setRailRef('primitive', el)">
          <template #reference>
            <button class="railButton" type="button" title="添加几何体" :disabled="!ready" @click="showRail('primitive')">
              <icon-box :size="18" />
            </button>
          </template>
          <div class="railPanel">
            <div class="panelTitle">添加几何体</div>
            <div class="primitiveGrid">
              <el-button v-for="item in primitives" :key="item.kind" size="small" @click="emit('addPrimitive', item.kind)">{{ item.label }}</el-button>
            </div>
          </div>
        </el-popover>
        <el-popover trigger="click" placement="right-start" :width="260" :ref="el => setRailRef('crowd', el)">
          <template #reference>
            <button class="railButton" type="button" title="群众阵列" :disabled="!ready" @click="showRail('crowd')">
              <icon-users :size="18" />
            </button>
          </template>
          <div class="railPanel">
            <div class="panelTitle">群众阵列</div>
            <div class="crowdRow">
              <el-input-number v-model="crowd.rows" :min="1" :max="5" size="small" controlsPosition="right" aria-label="阵列行数" />
              <span class="crowdX">×</span>
              <el-input-number v-model="crowd.cols" :min="1" :max="5" size="small" controlsPosition="right" aria-label="阵列列数" />
            </div>
            <div class="crowdRow">
              <el-input-number v-model="crowd.gap" :min="0.8" :max="4" :step="0.2" :precision="1" size="small" controlsPosition="right" aria-label="阵列间距" />
              <el-select v-model="crowd.facing" size="small" aria-label="阵列朝向">
                <el-option label="面向中心" value="center" />
                <el-option label="固定朝向" value="fixed" />
              </el-select>
            </div>
            <el-checkbox v-model="crowd.colored" size="small">随机配色</el-checkbox>
            <el-button size="small" type="primary" :disabled="!ready || addingMannequin" @click="emit('addCrowd', { ...crowd })">生成阵列</el-button>
          </div>
        </el-popover>
        <button class="railButton" type="button" title="添加机位" :disabled="!ready" @click="addAnchor">
          <icon-camera :size="18" />
        </button>
        <span class="railDivider" />
        <button class="railButton" :class="{ active: aiPanelOpen }" type="button" title="AI 导演" @click="toggleAiPanel">
          <icon-sparkles :size="18" />
        </button>
      </aside>
      <aside class="libraryPanel" aria-label="场景物体">
        <button class="libraryClose" type="button" aria-label="收起素材库" title="收起素材库" @click="libraryOpen = false"><icon-x :size="14" /></button>
        <section class="panelBlock refBlock">
          <div class="refCard">
            <template v-if="referenceImage">
              <img :src="referenceImage" alt="场景参考图" />
              <span class="refTag">{{ referenceLabel || "参考图" }}</span>
            </template>
            <div v-else class="refEmpty">
              <icon-photo :size="18" stroke="1.4" />
              <span>连接图片节点后，可识别参考图并搭建白模</span>
            </div>
          </div>
          <div class="refRow">
            <span>场景识别模型</span>
            <el-select :modelValue="model" class="modelSelect" size="small" filterable placeholder="选择模型" aria-label="场景识别模型" @update:modelValue="model = $event" @visibleChange="$event && emit('loadModels')">
              <el-option-group v-for="provider in aiModelGroups" :key="provider.id" :label="provider.label">
                <el-option v-for="item in provider.models" :key="item.modelId" :label="item.label" :value="JSON.stringify([item.providerId, item.modelId])" />
              </el-option-group>
            </el-select>
          </div>
          <el-button class="wideButton" size="small" type="primary" :disabled="!referenceImage || !model" @click="emit('recognizeScene')">识别场景图并搭建</el-button>
          <p class="panelHint">识别将重建当前白模场景，原参考素材保留；图中不可见部分会合理补全。</p>
        </section>

        <section class="panelBlock">
          <h3 class="panelTitle">添加对象</h3>
          <div class="addRow">
            <el-select v-model="addPreset" size="small" class="presetSelect" aria-label="人物体型">
              <el-option v-for="preset in mannequinPresets" :key="preset.name" :label="`${preset.name} ${preset.height.toFixed(2)} m`" :value="preset.name" />
            </el-select>
            <el-button size="small" type="primary" :loading="addingMannequin" :disabled="!ready || addingMannequin" @click="emit('addMannequin', { pose: addPose, preset: addPreset })">添加</el-button>
          </div>
          <div class="presetList">
            <button v-for="preset in mannequinPresets" :key="preset.name" type="button" class="presetItem" :disabled="!ready || addingMannequin" @click="emit('addMannequin', { preset: preset.name })">
              <icon-user :size="14" stroke="1.6" />
              <span>{{ preset.name }}</span>
              <small>{{ preset.height.toFixed(2) }} m</small>
            </button>
          </div>
          <button type="button" class="treeGroup" @click="toggleGroup('crowd')">
            <icon-chevron-right :size="14" class="treeArrow" :class="{ open: openGroups.has('crowd') }" />
            <span>人群</span>
          </button>
          <div v-if="openGroups.has('crowd')" class="crowdBlock">
            <div class="crowdRow">
              <el-input-number v-model="crowd.rows" :min="1" :max="5" size="small" controlsPosition="right" aria-label="阵列行数" />
              <span class="crowdX">×</span>
              <el-input-number v-model="crowd.cols" :min="1" :max="5" size="small" controlsPosition="right" aria-label="阵列列数" />
            </div>
            <div class="crowdRow">
              <el-input-number v-model="crowd.gap" :min="0.8" :max="4" :step="0.2" :precision="1" size="small" controlsPosition="right" aria-label="阵列间距" />
              <el-select v-model="crowd.facing" size="small" aria-label="阵列朝向">
                <el-option label="面向中心" value="center" />
                <el-option label="固定朝向" value="fixed" />
              </el-select>
            </div>
            <el-checkbox v-model="crowd.colored" size="small">随机配色</el-checkbox>
            <el-button size="small" type="primary" :disabled="!ready || addingMannequin" @click="emit('addCrowd', { ...crowd })">生成阵列</el-button>
          </div>
          <template v-for="group in propGroups" :key="group.key">
            <button type="button" class="treeGroup" @click="toggleGroup(`prop-${group.key}`)">
              <icon-chevron-right :size="14" class="treeArrow" :class="{ open: openGroups.has(`prop-${group.key}`) }" />
              <span>{{ group.label }}</span>
            </button>
            <div v-if="openGroups.has(`prop-${group.key}`)" class="propGrid">
              <button v-for="item in group.items" :key="item.kind" type="button" class="propItem" :disabled="!ready" :title="`添加${item.label}`" @click="emit('addProp', item.kind)">{{ item.label }}</button>
            </div>
          </template>
        </section>

        <section class="panelBlock sceneBlock">
          <h3 class="panelTitle">场景内容 <small>{{ scene.objectList.length }}/200</small></h3>
          <el-input v-model="keyword" size="small" clearable placeholder="输入名称搜索场景物体" aria-label="搜索场景物体" :prefix-icon="IconSearch" />
          <div class="libraryTree">
            <template v-for="group in objectGroups" :key="group.key">
              <button type="button" class="treeGroup" @click="toggleGroup(group.key)">
                <icon-chevron-right :size="14" class="treeArrow" :class="{ open: openGroups.has(group.key) }" />
                <span>{{ group.label }}</span>
                <small>{{ group.items.length }}</small>
              </button>
              <template v-if="openGroups.has(group.key)">
                <div
                  v-for="item in group.items"
                  :key="item.id"
                  class="treeItem"
                  :class="{ selected: item.id === selectedId }"
                  role="button"
                  tabindex="0"
                  :title="item.name"
                  @click="item.kind === 'anchor' ? jumpToAnchor(item.anchor!) : selectObject(item.id)"
                  @keydown.enter="item.kind === 'anchor' ? jumpToAnchor(item.anchor!) : selectObject(item.id)">
                  <component :is="group.icon" :size="15" stroke="1.6" />
                  <span class="treeName">{{ item.name }}</span>
                  <span v-if="item.kind === 'anchor' && item.anchor?.id === activeAnchorId" class="treeDot" />
                </div>
              </template>
            </template>
            <div v-if="!scene.objectList.length && !anchors.length" class="libraryEmpty">
              <icon-cube3d-sphere :size="28" stroke="1.2" />
              <span>场景还是空的<br />从左侧添加人物、道具或机位</span>
            </div>
          </div>
        </section>
        <p class="panelFooter">白模预演用于表达构图、走位和运镜，最终效果由后续生成决定。</p>
      </aside>
      <section class="stagePanel" aria-label="场景与镜头">
        <div class="stageToolbar">
          <div class="viewToggle" role="tablist" aria-label="视角切换">
            <button type="button" :class="{ active: viewMode === 'director' }" @click="setViewMode('director')">导演视角</button>
            <button type="button" :class="{ active: viewMode === 'camera' }" @click="setViewMode('camera')">机位预览</button>
          </div>
          <el-select :modelValue="activeAnchorId" class="cameraSelect" size="small" placeholder="选择机位" aria-label="选择机位" @change="onCameraSelect">
            <el-option v-for="(anchor, index) in anchors" :key="anchor.id" :label="anchor.name || `机位 ${index + 1}`" :value="anchor.id" />
          </el-select>
          <el-select v-model="aspectRatio" class="aspectSelect" size="small" aria-label="画面比例">
            <el-option v-for="ratio in aspectOptions" :key="ratio" :label="ratio" :value="ratio" />
          </el-select>
          <div class="transformModes" role="group" aria-label="变换模式">
            <button v-for="mode in transformModeOptions" :key="mode.value" type="button" :class="{ active: transformMode === mode.value }" :disabled="!selectedObject || viewMode !== 'director'" :title="`${mode.label}（${mode.shortcut}）`" @click="setTransformMode(mode.value)">{{ mode.label }}</button>
          </div>
          <span class="toolbarSpacer" />
          <button type="button" class="toolPill" :class="{ active: guidesVisible }" title="显示画幅与构图参考线" @click="guidesVisible = !guidesVisible">
            <icon-grid-dots :size="13" /> 参考线
          </button>
        </div>
        <div class="viewport" :style="{ '--sceneAspect': sceneAspect }">
          <canvas
            :key="canvasKey"
            ref="canvas"
            class="sceneCanvas"
            :class="{ playing, cameraView: viewMode === 'camera' }"
            tabindex="0"
            aria-label="导演台场景"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @wheel="onWheel" />
          <div v-if="captureFlash" :key="captureFlash" class="captureFlash" aria-hidden="true" @animationend="captureFlash = 0" />
          <div v-if="guidesVisible" class="frameGuides" aria-hidden="true">
            <span class="guideLine vertical" style="left: 33.333%" />
            <span class="guideLine vertical" style="left: 66.666%" />
            <span class="guideLine horizontal" style="top: 33.333%" />
            <span class="guideLine horizontal" style="top: 66.666%" />
            <span class="guideSafe" />
            <span class="guideLabel">{{ aspectRatio }} · 安全框</span>
          </div>
          <div class="axisTools">
            <svg class="axisGizmo" viewBox="0 0 72 72" width="56" height="56" aria-label="坐标轴" role="img">
              <circle cx="36" cy="36" r="30" class="axisRing" />
              <g v-for="axis in sortedAxes" :key="axis.key" :class="`axis-${axis.key.replace('-', 'n')}`">
                <line :x1="36" :y1="36" :x2="axis.x" :y2="axis.y" :class="{ negative: axis.negative }" />
                <circle v-if="axis.negative" :cx="axis.x" :cy="axis.y" r="3" />
                <text v-else :x="axis.x + (axis.x - 36) * 0.18" :y="axis.y + (axis.y - 36) * 0.18 + 3">{{ axis.key.toUpperCase() }}</text>
              </g>
            </svg>
            <button type="button" class="toolPill" title="重置视角 (R)" @click="resetView"><icon-refresh :size="13" /> 重置视角</button>
          </div>
          <div class="viewportInfo">
            <span>{{ viewMode === "camera" ? "拖动画面摇摄 / 俯仰 · 滚轮变焦" : orbiting ? "环绕运镜中" : playing ? "播放中" : "拖拽旋转 · 右键平移 · 滚轮缩放 · 点击选中" }}</span>
            <span v-if="viewMode !== 'camera'">{{ focalLength.toFixed(0) }} mm · {{ aspectRatio }}</span>
          </div>
          <div v-if="viewMode === 'camera' && ready" class="cameraHud" aria-label="镜头参数">
            <span class="hudLens">{{ anchorFocal }} mm</span>
            <span>FOV {{ Math.round(activeAnchor?.camera.fov ?? 0) }}°</span>
            <span>水平 {{ Math.round(cameraAngles.yaw) }}° · 俯仰 {{ Math.round(cameraAngles.pitch) }}°</span>
            <span v-if="Math.abs(cameraAngles.roll) >= 0.5" class="hudRoll">滚转 {{ Math.round(cameraAngles.roll) }}°</span>
          </div>
          <div v-if="viewMode === 'camera'" class="cameraReticle" aria-hidden="true">
            <i /><i /><span />
          </div>
          <button
            v-if="viewMode === 'director' && pipAnchor && anchorPreviews[pipAnchor.id]"
            type="button"
            class="cameraPip"
            :title="`机位画中画：${pipAnchor.name || '机位'}`"
            @click="jumpToAnchor(pipAnchor)">
            <img :src="anchorPreviews[pipAnchor.id]!" alt="机位预览" />
            <span>{{ pipAnchor.name || "机位" }}</span>
          </button>
          <div v-if="!ready" class="stageLoading" :class="{ failed: !!stageError }">
            <template v-if="stageError">
              <icon-alert-triangle :size="24" />
              <span class="stageError">{{ stageError }}</span>
              <el-button size="small" type="primary" plain @click="loadScene()">重试</el-button>
            </template>
            <template v-else>
              <icon-loader-2 class="loadingIcon" :size="24" />
              <span>正在载入场景</span>
            </template>
          </div>
          <div class="viewShortcuts">
            <button type="button" class="toolPill" :disabled="!ready" title="切换到正视角" @click="frontView"><icon-eye :size="13" /> 正视角</button>
            <button type="button" class="toolPill" :class="{ active: orbiting }" :disabled="!ready || viewMode !== 'director'" title="相机绕目标环绕" @click="toggleOrbit"><icon-rotate-clockwise :size="13" /> 环绕相机运动</button>
          </div>
          <div v-if="yawRingAvailable" class="ringTip"><icon-rotate-clockwise :size="12" /> 拖动圆形手柄旋转人物 <span>Shift 对齐 15°</span></div>
          <form class="cameraPrompt" @submit.prevent="sendCameraPrompt">
            <icon-sparkles :size="15" />
            <input v-model="cameraPrompt" type="text" maxlength="400" placeholder="描述镜头运动，AI 生成运镜方案" aria-label="AI 运镜描述" />
            <button type="submit" :disabled="!cameraPrompt.trim()" title="生成运镜" aria-label="生成运镜"><icon-arrow-up :size="15" /></button>
          </form>
        </div>
        <div class="timelinePanel">
          <div class="timelineMeta">
            <span class="metaTitle">已记录关键帧</span>
            <span class="metaItem">镜头 {{ cameraMarks.length }} · 对象 {{ objectFrameCount }} 帧 / {{ objectTrackCount }} 轨</span>
            <span class="metaItem">全场景 {{ scene.objectList.length }} 个物体</span>
            <span class="metaItem">{{ anchors.length }} 个机位</span>
            <span class="metaSpacer" />
            <el-popover trigger="click" placement="top-start" :width="292" :teleported="true">
              <template #reference>
                <button type="button" class="metaAction" :disabled="!ready" title="按全场景 / 机位 / 镜头查看关键帧">
                  <icon-list :size="12" /> 轨道
                </button>
              </template>
              <div class="trackGroups">
                <section>
                  <h4>全场景 <small>{{ objectTrackCount }} 轨 · {{ objectFrameCount }} 帧</small></h4>
                  <button v-for="track in objectTrackSummaries" :key="track.key" type="button" @click="seekTime(track.start)">
                    <span>{{ track.name }}</span><small>{{ track.frames }} 帧 · {{ track.start.toFixed(1) }}–{{ track.end.toFixed(1) }}s</small>
                  </button>
                  <p v-if="!objectTrackSummaries.length">暂无物体动画轨道</p>
                </section>
                <section>
                  <h4>机位 <small>{{ anchors.length }}</small></h4>
                  <button v-for="anchor in anchors" :key="anchor.id" type="button" @click="jumpToAnchor(anchor)">
                    <span>{{ anchor.name || "机位" }}</span><small>{{ anchor.time !== undefined ? `${anchor.time.toFixed(2)}s` : "自由机位" }}</small>
                  </button>
                  <p v-if="!anchors.length">暂无机位</p>
                </section>
                <section>
                  <h4>镜头关键帧 <small>{{ cameraMarks.length }}</small></h4>
                  <button v-for="frame in cameraMarks" :key="frame.key" type="button" @click="seekTime(frame.time)">
                    <span>镜头 {{ frame.time.toFixed(2) }}s</span><small>点击跳转</small>
                  </button>
                  <p v-if="!cameraMarks.length">尚未记录镜头关键帧</p>
                </section>
              </div>
            </el-popover>
            <button type="button" class="metaAction" :disabled="!ready" title="把当前镜头记录为关键帧（没有方案时自动新建）" @click="recordCameraKeyframe">
              <icon-point :size="12" /> 记录关键帧
            </button>
          </div>
          <div class="timelineBar">
            <el-button
              class="iconButton"
              :icon="playing ? IconPlayerPause : IconPlayerPlay"
              :disabled="!ready || !result"
              text
              :aria-label="playing ? '暂停影片' : '播放影片'"
              :title="playing ? '暂停 (空格)' : '播放 (空格)'"
              @click="togglePlayback" />
            <el-button class="iconButton" :icon="IconPlayerTrackPrev" :disabled="!result" text aria-label="回到起点" title="回到起点" @click="seekTime(0)" />
            <el-button class="iconButton" :icon="IconPhotoPlus" :disabled="!ready" text aria-label="生成该项目图片" title="生成该项目图片：把当前画面导出到画布" @click="captureScreenshot" />
            <el-button class="iconButton" :icon="IconPlus" :disabled="!ready" text aria-label="添加机位" title="在当前时间添加机位" @click="addAnchor" />
            <span class="timeLabel">{{ formatTime(currentTime) }} / {{ formatTime(result?.duration ?? 0) }} 秒</span>
            <div class="timelineTrack" :aria-label="`时间轴，共 ${result?.duration ?? 0} 秒`" @click="seekFromTrack">
              <div class="timelineRuler" />
              <span v-for="tick in rulerTicks" :key="`tick-${tick.time}`" class="timelineTick" :style="{ left: `${tick.percent}%` }">{{ tick.label }}</span>
              <span
                v-for="frame in cameraMarks"
                :key="frame.key"
                class="timelineCamera"
                :style="{ left: `${frame.percent}%` }"
                :title="`镜头关键帧 · ${frame.time.toFixed(2)} 秒`" />
              <span
                v-for="frame in keyframeMarks"
                :key="frame.key"
                class="timelineKey"
                :style="{ left: `${frame.percent}%` }"
                :title="`${frame.name} · ${frame.time.toFixed(2)} 秒`" />
              <span
                v-for="anchor in timedAnchors"
                :key="anchor.id"
                class="timelineMarker"
                :class="{ selected: anchor.id === activeAnchorId }"
                :style="{ left: `${markerPercent(anchor)}%` }"
                :title="anchor.name || '机位'"
                @click.stop="jumpToAnchor(anchor)" />
              <div v-if="result" class="timelineCursor" :style="{ left: `${cursorPercent}%` }" />
            </div>
            <el-button class="exportButton exportStart" :icon="IconMovie" :disabled="!ready || !result || exportingVideo" :loading="exportingVideo" aria-label="生成视频的镜头" @click="emit('exportVideo', sceneAspect)">
              {{ exportingVideo ? `${exportProgress ?? 0}%` : "生成镜头视频" }}
            </el-button>
            <el-dropdown class="exportButton" trigger="click" placement="top-end" @command="command => exportStoryboard(command)">
              <el-button :icon="IconFileText" :disabled="!ready || !plans.length || exportingBoard" :loading="exportingBoard" aria-label="导出分镜板">
                {{ exportingBoard ? "生成中…" : "分镜板" }}
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="print" :icon="IconPrinter">打印 / 另存为 PDF</el-dropdown-item>
                  <el-dropdown-item command="html" :icon="IconFileText">下载 HTML 文件</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </section>
      <aside class="settingsPanel" aria-label="属性面板">
        <el-tabs v-model="panelTab" class="panelTabs">
          <el-tab-pane label="角色" name="object">
            <template v-if="selectedObject">
              <el-tabs v-model="objectTab" class="subTabs">
                <el-tab-pane label="属性" name="props">
                  <div class="fieldRow">
                    <span>名称</span>
                    <el-input v-model="draftName" size="small" maxlength="60" placeholder="物体名称" aria-label="物体名称" @change="commitName" @keyup.enter="commitName" />
                  </div>
                  <div class="fieldRow">
                    <span>位置</span>
                    <label class="axisField"><small>X</small><el-input-number :modelValue="round(selectedObject.position.x)" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="位置 X" @change="value => commitVector('position', 'x', value)" /></label>
                    <label class="axisField"><small>Y</small><el-input-number :modelValue="round(selectedObject.position.y)" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="位置 Y" @change="value => commitVector('position', 'y', value)" /></label>
                    <label class="axisField"><small>Z</small><el-input-number :modelValue="round(selectedObject.position.z)" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="位置 Z" @change="value => commitVector('position', 'z', value)" /></label>
                  </div>
                  <div class="fieldRow">
                    <span>旋转</span>
                    <label class="axisField"><small>X</small><el-input-number :modelValue="toDegree(selectedObject.rotation?.rotationX)" :step="5" size="small" controlsPosition="right" aria-label="旋转 X" @change="value => commitRotation('rotationX', value)" /></label>
                    <label class="axisField"><small>Y</small><el-input-number :modelValue="toDegree(selectedObject.rotation?.rotationY)" :step="5" size="small" controlsPosition="right" aria-label="旋转 Y" @change="value => commitRotation('rotationY', value)" /></label>
                    <label class="axisField"><small>Z</small><el-input-number :modelValue="toDegree(selectedObject.rotation?.rotationZ)" :step="5" size="small" controlsPosition="right" aria-label="旋转 Z" @change="value => commitRotation('rotationZ', value)" /></label>
                  </div>
                  <div class="fieldRow">
                    <span>缩放</span>
                    <label class="axisField"><small>X</small><el-input-number :modelValue="round(selectedObject.scale?.scaleX ?? 1)" :min="0.05" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="缩放 X" @change="value => commitVector('scale', 'scaleX', value)" /></label>
                    <label class="axisField"><small>Y</small><el-input-number :modelValue="round(selectedObject.scale?.scaleY ?? 1)" :min="0.05" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="缩放 Y" @change="value => commitVector('scale', 'scaleY', value)" /></label>
                    <label class="axisField"><small>Z</small><el-input-number :modelValue="round(selectedObject.scale?.scaleZ ?? 1)" :min="0.05" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="缩放 Z" @change="value => commitVector('scale', 'scaleZ', value)" /></label>
                  </div>
                  <div class="fieldRow">
                    <span>统一缩放</span>
                    <el-slider :modelValue="round(selectedObject.scale?.scaleX ?? 1)" :min="0.1" :max="4" :step="0.05" aria-label="统一缩放" @change="value => commitUniformScale(Number(value))" />
                    <span class="sliderValue">{{ round(selectedObject.scale?.scaleX ?? 1) }}</span>
                  </div>
                  <div class="fieldRow">
                    <span>颜色</span>
                    <el-color-picker :modelValue="selectedObject.material.color" :teleported="false" colorFormat="hex" size="small" aria-label="物体颜色" @change="$event && emit('updateObject', selectedObject.threeJsonId, { color: $event })" />
                    <span class="colorValue">{{ selectedObject.material.color }}</span>
                  </div>
                  <div v-if="selectedObject.model" class="fieldRow">
                    <span>模型文件</span>
                    <span class="fileName" :title="selectedObject.model.path">{{ fileName(selectedObject.model.path) }}</span>
                    <el-button size="small" :loading="uploadingModel" :disabled="uploadingModel" @click="replaceObjectId = selectedObject.threeJsonId; modelInput?.click()">更换</el-button>
                  </div>
                  <p v-if="objectTracks.length" class="fieldHint">该物体已有动画轨道：画面显示的是时间轴当前时间的位置，这里的属性作为初始状态，可在「动画轨迹」中记录为关键帧。</p>
                  <div class="buttonRow">
                    <el-button size="small" :icon="IconFocus2" title="聚焦 (F)" @click="focusObject(selectedObject.threeJsonId)">聚焦</el-button>
                    <el-button size="small" :icon="IconCopy" @click="emit('duplicateObject', selectedObject.threeJsonId)">复制</el-button>
                    <el-button size="small" type="danger" plain :icon="IconTrash" title="删除 (Delete)" @click="emit('removeObject', selectedObject.threeJsonId)">删除</el-button>
                  </div>
                </el-tab-pane>
                <el-tab-pane :label="selectedObject.objType === 'mannequin' ? '姿势' : '外观'" name="pose" :disabled="selectedObject.objType !== 'mannequin'">
                  <template v-if="selectedObject.objType === 'mannequin'">
                    <div class="sectionLabel">姿势预设</div>
                    <div class="poseGrid">
                      <button v-for="preset in posePresets" :key="preset.name" type="button" class="poseCard" :class="{ active: activePoseName === preset.name }" @click="emit('applyPose', selectedObject.threeJsonId, preset.name)">
                        {{ preset.name }}
                      </button>
                    </div>
                    <div class="sectionLabel">关节微调 <small>单位：度</small></div>
                    <el-select v-model="jointName" size="small" aria-label="选择关节" class="jointSelect">
                      <el-option v-for="joint in mannequinJoints" :key="joint" :label="jointLabels[joint]" :value="joint" />
                    </el-select>
                    <div v-for="axis in jointAxes" :key="axis.key" class="fieldRow">
                      <span>{{ axis.label }}</span>
                      <el-slider :modelValue="jointValue(axis.key)" :min="-180" :max="180" :step="1" :aria-label="`关节 ${axis.label}`" @change="value => commitJoint(axis.key, Number(value))" />
                      <span class="sliderValue">{{ jointValue(axis.key) }}°</span>
                    </div>
                    <div class="buttonRow">
                      <el-button size="small" text :icon="IconReload" @click="emit('updateObject', selectedObject.threeJsonId, { pose: { ...selectedObject.pose, [jointName]: { x: 0, y: 0, z: 0 } } })">当前关节归零</el-button>
                      <el-button size="small" text :icon="IconReload" @click="emit('applyPose', selectedObject.threeJsonId, '自然站立')">全身归零</el-button>
                    </div>
                  </template>
                  <p v-else class="fieldHint">几何体与模型的外观由「属性」中的颜色与缩放控制。</p>
                </el-tab-pane>
                <el-tab-pane label="动画轨迹" name="track">
                  <div class="sectionLabel">{{ result?.name ?? "尚未选择方案" }} <small>{{ result?.duration ?? 0 }} 秒</small></div>
                  <div class="buttonRow">
                    <el-button size="small" type="primary" :icon="IconPoint" @click="emit('addKeyframe', selectedObject.threeJsonId, currentTime)">在 {{ currentTime.toFixed(2) }}s 记录关键帧</el-button>
                    <el-button size="small" :icon="IconTrash" :disabled="!objectKeyframeAtCurrent" @click="removeObjectKeyframeAtCurrent">删除当前关键帧</el-button>
                  </div>
                  <p class="fieldHint">先把物体摆好位置或姿势，再在时间轴上选择时间点记录关键帧；两个关键帧之间自动插值。</p>
                  <div class="trackList">
                    <div v-for="track in objectTracks" :key="track.key" class="trackItem">
                      <span class="trackName">{{ track.label }}</span>
                      <small>{{ track.frames.length }} 帧 · {{ track.start.toFixed(1) }}–{{ track.end.toFixed(1) }}s</small>
                      <el-button text size="small" type="danger" :icon="IconTrash" aria-label="删除轨道" @click="emit('removeTrack', selectedObject.threeJsonId, track.joint)" />
                    </div>
                    <div v-if="!objectTracks.length" class="libraryEmpty">该物体暂无动画轨道</div>
                  </div>
                </el-tab-pane>
              </el-tabs>
            </template>
            <div v-else class="panelEmpty">
              <icon-cube3d-sphere :size="30" stroke="1.2" />
              <p>在视口或左侧列表中点击角色、几何体进行选择</p>
              <div class="emptyActions">
                <el-button size="small" type="primary" :icon="IconUserPlus" :loading="addingMannequin" :disabled="!ready || addingMannequin" @click="emit('addMannequin', { pose: addPose, preset: addPreset })">添加人偶</el-button>
                <el-button size="small" :icon="IconUpload" :loading="uploadingModel" :disabled="!ready || uploadingModel" @click="replaceObjectId = ''; modelInput?.click()">上传模型</el-button>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="机位" name="anchor">
            <div class="anchorGrid">
              <button
                v-for="(anchor, index) in anchors"
                :key="anchor.id"
                type="button"
                class="anchorCard"
                :class="{ active: anchor.id === activeAnchorId }"
                @click="jumpToAnchor(anchor)">
                <img v-if="anchorPreviews[anchor.id]" :src="anchorPreviews[anchor.id]" alt="" />
                <div v-else class="anchorThumbEmpty"><icon-camera :size="18" /></div>
                <span>{{ anchor.name || `机位 ${index + 1}` }}</span>
                <small>{{ anchor.time !== undefined ? `${anchor.time.toFixed(1)}s` : "自由机位" }}<template v-if="shootingAnchorId === anchor.id"> · 拍摄</template></small>
              </button>
              <button type="button" class="anchorCard addCard" :disabled="!ready" @click="addAnchor"><icon-plus :size="18" /><span>添加机位</span></button>
            </div>
            <div class="buttonRow">
              <el-button size="small" :icon="IconLayoutGrid" :disabled="!ready || anchors.length < 9 || !!exportingImage || exportingVideo" :title="anchors.length < 9 ? '需要至少 9 个机位' : '导出 9 宫格多角度参考图到画布'" @click="emit('exportContact', 9, sceneAspect)">9 宫格</el-button>
              <el-button size="small" :icon="IconLayoutGrid" :disabled="!ready || anchors.length < 25 || !!exportingImage || exportingVideo" :title="anchors.length < 25 ? '需要至少 25 个机位' : '导出 25 宫格多角度参考图到画布'" @click="emit('exportContact', 25, sceneAspect)">25 宫格</el-button>
              <el-button size="small" :icon="IconPhotoPlus" :disabled="!ready || !anchors.length || !!exportingImage || exportingVideo" title="把每个机位各导出一张图片到画布" @click="emit('exportAllAnchors', sceneAspect)">导出全部机位</el-button>
            </div>
            <section v-if="activeAnchor" class="panelSection">
              <h3>机位设置 <small>{{ activeAnchor.name }}</small><span v-if="shootingAnchorId === activeAnchor.id" class="shootBadge">拍摄机位</span></h3>
              <div class="fieldRow">
                <span>名称</span>
                <el-input v-model="activeAnchor.name" size="small" maxlength="60" placeholder="机位名称" aria-label="机位名称" @change="renameAnchor" />
              </div>
              <div class="fieldRow vectorRow">
                <span>位置</span>
                <label class="axisField"><small>X</small><el-input-number :modelValue="round(activeAnchor.camera.position.x)" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="机位位置 X" @change="value => commitAnchorVector('position', 'x', value)" /></label>
                <label class="axisField"><small>Y</small><el-input-number :modelValue="round(activeAnchor.camera.position.y)" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="机位位置 Y" @change="value => commitAnchorVector('position', 'y', value)" /></label>
                <label class="axisField"><small>Z</small><el-input-number :modelValue="round(activeAnchor.camera.position.z)" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="机位位置 Z" @change="value => commitAnchorVector('position', 'z', value)" /></label>
              </div>
              <div class="sectionLabel">拍摄角度 <small>也可在机位视角直接拖动画面</small></div>
              <div class="fieldRow angleRow">
                <span>水平</span>
                <el-slider :modelValue="Math.round(cameraAngles.yaw)" :min="-180" :max="180" :step="1" :show-tooltip="false" aria-label="机位水平角" @update:modelValue="value => setAnchorAngles({ yaw: Number(value) })" @change="commitAnchorAngles" />
                <span class="sliderValue">{{ Math.round(cameraAngles.yaw) }}°</span>
              </div>
              <div class="fieldRow angleRow">
                <span>俯仰</span>
                <el-slider :modelValue="Math.round(cameraAngles.pitch)" :min="-85" :max="85" :step="1" :show-tooltip="false" aria-label="机位俯仰角" @update:modelValue="value => setAnchorAngles({ pitch: Number(value) })" @change="commitAnchorAngles" />
                <span class="sliderValue">{{ Math.round(cameraAngles.pitch) }}°</span>
              </div>
              <div class="fieldRow angleRow">
                <span>滚转</span>
                <el-slider :modelValue="Math.round(cameraAngles.roll)" :min="-45" :max="45" :step="1" :show-tooltip="false" aria-label="机位滚转角" @update:modelValue="value => setAnchorAngles({ roll: Number(value) })" @change="commitAnchorAngles" />
                <span class="sliderValue">{{ Math.round(cameraAngles.roll) }}°</span>
              </div>
              <div class="angleChips">
                <button type="button" title="机位降到与被摄体同高" @click="setShotAngle('level')">平视</button>
                <button type="button" title="机位升高俯拍" @click="setShotAngle('high')">俯拍</button>
                <button type="button" title="机位降低仰拍" @click="setShotAngle('low')">仰拍</button>
                <button type="button" title="画面倾斜 12° / 回正" @click="setShotAngle('dutch')">荷兰角</button>
                <button type="button" title="回正并对准被摄体" @click="setShotAngle('reset')">复位</button>
              </div>
              <div class="fieldRow">
                <span>焦段</span>
                <el-slider :modelValue="anchorFocal" :min="12" :max="135" :step="1" :show-tooltip="false" aria-label="机位焦段" @update:modelValue="value => setAnchorFocal(Number(value))" />
                <span class="sliderValue">{{ anchorFocal }}mm</span>
              </div>
              <div class="fieldRow">
                <span>视野角度</span>
                <el-input-number v-model="activeAnchor.camera.fov" size="small" :min="10" :max="120" :step="1" controlsPosition="right" aria-label="机位视场角" @change="applyAnchorFov" />
              </div>
              <div class="fieldRow vectorRow">
                <span>注视目标</span>
                <label class="axisField"><small>X</small><el-input-number :modelValue="round(activeAnchor.controls.target.x)" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="朝向目标 X" @change="value => commitAnchorVector('target', 'x', value)" /></label>
                <label class="axisField"><small>Y</small><el-input-number :modelValue="round(activeAnchor.controls.target.y)" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="朝向目标 Y" @change="value => commitAnchorVector('target', 'y', value)" /></label>
                <label class="axisField"><small>Z</small><el-input-number :modelValue="round(activeAnchor.controls.target.z)" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="朝向目标 Z" @change="value => commitAnchorVector('target', 'z', value)" /></label>
              </div>
              <div class="fieldRow">
                <span>注视物体</span>
                <el-select v-model="lookTarget" size="small" placeholder="选择物体" filterable clearable aria-label="注视目标">
                  <el-option v-for="object in scene.objectList" :key="object.threeJsonId" :label="object.name || object.objType" :value="object.threeJsonId" />
                </el-select>
              </div>
              <div class="framingRow">
                <span>构图</span>
                <button type="button" title="机位沿当前朝向推拉到全身景别" @click="frameSubject('full')">全身</button>
                <button type="button" title="推近到半身景别" @click="frameSubject('half')">半身</button>
                <button type="button" title="推近到特写景别" @click="frameSubject('close')">特写</button>
              </div>
              <div class="buttonRow">
                <el-button size="small" :icon="IconTarget" :disabled="!lookTarget" @click="applyLookTarget">应用注视</el-button>
                <el-button size="small" :icon="IconCamera" @click="setAnchorFromDirectorView">将导演视角设为此机位</el-button>
              </div>
              <div class="buttonRow">
                <el-button size="small" :type="shootingAnchorId === activeAnchor.id ? 'primary' : 'default'" :icon="IconCamera" @click="markShootingAnchor">{{ shootingAnchorId === activeAnchor.id ? "已设为拍摄机位" : "设为拍摄机位" }}</el-button>
                <el-button size="small" :icon="IconPhotoPlus" :disabled="!!exportingImage" :loading="exportingImage === activeAnchor.id" @click="emit('exportImage', activeAnchor, sceneAspect, activeAnchor.time ?? currentTime)">导出画布</el-button>
              </div>
              <div class="buttonRow">
                <el-button size="small" :icon="IconPoint" :disabled="!ready" @click="recordCameraKeyframe">记录关键帧</el-button>
                <el-button size="small" :icon="IconTrash" :disabled="!cameraKeyframeAtCurrent" @click="removeCameraKeyframeAtCurrent">删除当前关键帧</el-button>
              </div>
              <div class="buttonRow">
                <el-button size="small" :icon="IconCopy" @click="duplicateAnchor">复制对象</el-button>
                <el-button size="small" type="danger" plain :icon="IconTrash" @click="removeAnchor(activeAnchor.id)">删除对象</el-button>
              </div>
              <p class="fieldHint">机位是镜头位置与朝向；记录关键帧会把当前镜头写入时间轴，供生成运镜使用。</p>
            </section>
            <p v-else class="fieldHint">点击上方机位卡片切换到机位视角并编辑参数。</p>
          </el-tab-pane>
          <el-tab-pane label="场景" name="scene">
            <section class="panelSection">
              <h3>环境</h3>
              <div class="fieldRow">
                <span>背景色</span>
                <el-color-picker :modelValue="scene.sceneConfig.scene.background" :teleported="false" colorFormat="hex" size="small" aria-label="背景色" @change="$event && emit('updateScene', { background: $event })" />
                <span class="colorValue">{{ scene.sceneConfig.scene.background }}</span>
              </div>
              <div class="fieldRow">
                <span>全景背景</span>
                <el-switch :modelValue="sceneSettings.backdropEnabled" aria-label="启用全景背景" @change="sceneSettings = { ...sceneSettings, backdropEnabled: $event === true }" />
                <el-button size="small" :disabled="uploadingBackdrop || !sceneSettings.backdropPath" @click="removeBackdrop">移除</el-button>
              </div>
              <div class="fieldRow">
                <span>背景图片</span>
                <input ref="backdropInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onBackdropSelect" />
                <el-button size="small" :disabled="uploadingBackdrop" :loading="uploadingBackdrop" @click="backdropInput?.click()">{{ uploadingBackdrop ? "上传中…" : sceneSettings.backdropPath ? "更换图片" : "上传 2D 场景图" }}</el-button>
              </div>
              <p class="fieldHint">上传一张 2D 场景图作为 360° 全景背景，人物与几何体摆放在它前面。</p>
              <div v-if="sceneSettings.backdropPath" class="backdropThumb"><img v-if="backdropUrl" :src="backdropUrl" alt="全景背景预览" /><icon-loader-2 v-else class="loadingIcon" :size="18" /></div>
              <template v-if="sceneSettings.backdropEnabled && sceneSettings.backdropPath">
                <div class="fieldRow">
                  <span>缩放</span>
                  <el-slider :modelValue="sceneSettings.backdropScale" :min="0.5" :max="3" :step="0.05" @update:modelValue="sceneSettings = { ...sceneSettings, backdropScale: Number($event) }" />
                </div>
                <div class="fieldRow">
                  <span>旋转角度</span>
                  <el-slider :modelValue="sceneSettings.backdropRotation" :min="0" :max="360" :step="1" @update:modelValue="sceneSettings = { ...sceneSettings, backdropRotation: Number($event) }" />
                </div>
                <div class="fieldRow">
                  <span>位置高度</span>
                  <el-slider :modelValue="sceneSettings.backdropOffsetY" :min="-100" :max="100" :step="1" @update:modelValue="sceneSettings = { ...sceneSettings, backdropOffsetY: Number($event) }" />
                </div>
              </template>
            </section>
            <section class="panelSection">
              <h3>全局光照</h3>
              <div class="presetRow">
                <button
                  v-for="preset in lightingPresets"
                  :key="preset.name"
                  type="button"
                  class="presetChip"
                  :style="{ '--swatch': preset.swatch }"
                  :title="`${preset.name}：仰角 ${preset.patch.elevation}°`"
                  @click="applyPreset(preset)">{{ preset.name }}</button>
              </div>
              <lightDirection v-model:azimuth="lightAzimuth" v-model:elevation="lightElevation" :referenceAzimuth="referenceAzimuth" />
              <div class="sectionLabel">24 光位 <small>相对当前视角</small></div>
              <div class="lightGrid">
                <div v-for="height in lightHeights" :key="height.key" class="lightRow">
                  <span class="lightHeight">{{ height.label }}</span>
                  <button
                    v-for="direction in lightDirections"
                    :key="direction.offset"
                    type="button"
                    class="lightDot"
                    :class="{ active: isActiveLight(direction.offset, height.elevation) }"
                    :title="`主光：${direction.label} · ${height.label}位`"
                    :aria-label="`主光：${direction.label} ${height.label}位`"
                    @click="applyLightPosition(direction.offset, height.elevation)" />
                </div>
              </div>
              <div class="sectionLabel">色温</div>
              <div class="presetRow">
                <button v-for="item in colorTemperatures" :key="item.label" type="button" class="presetChip" :style="{ '--swatch': item.color }" @click="updateLighting({ color: item.color, sunEnabled: true })">{{ item.label }}</button>
              </div>
              <div class="fieldRow">
                <span>太阳方位</span>
                <el-slider :modelValue="lighting.azimuth" :min="0" :max="360" :step="1" aria-label="太阳方位" @update:modelValue="$event != null && updateLighting({ azimuth: Number($event) })" />
                <span class="sliderValue">{{ Math.round(lighting.azimuth) }}°</span>
              </div>
              <div class="fieldRow">
                <span>太阳仰角</span>
                <el-slider :modelValue="lighting.elevation" :min="-10" :max="90" :step="1" aria-label="太阳仰角" @update:modelValue="$event != null && updateLighting({ elevation: Number($event) })" />
                <span class="sliderValue">{{ Math.round(lighting.elevation) }}°</span>
              </div>
              <div class="fieldRow">
                <span>主光开关</span>
                <el-switch :modelValue="lighting.sunEnabled" aria-label="主光开关" @change="updateLighting({ sunEnabled: $event === true })" />
              </div>
              <div class="fieldRow">
                <span>主光强度</span>
                <el-input-number :modelValue="lighting.intensity" :min="0" :max="100" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="太阳强度" @update:modelValue="$event != null && updateLighting({ intensity: $event, sunEnabled: true })" />
              </div>
              <div class="fieldRow">
                <span>主光颜色</span>
                <el-color-picker :modelValue="lighting.color" :teleported="false" colorFormat="hex" size="small" aria-label="太阳颜色" @change="$event && updateLighting({ color: $event, sunEnabled: true })" />
              </div>
              <div class="fieldRow">
                <span>环境光强度</span>
                <el-input-number :modelValue="lighting.globalIntensity" :min="0" :max="100" :step="0.1" :precision="2" size="small" controlsPosition="right" aria-label="全局光照强度" @update:modelValue="$event != null && updateLighting({ globalIntensity: $event, globalEnabled: true })" />
              </div>
            </section>
            <section class="panelSection">
              <h3>地面</h3>
              <div class="fieldRow">
                <span>显示网格</span>
                <el-switch :modelValue="sceneSettings.gridVisible" aria-label="显示网格" @change="sceneSettings = { ...sceneSettings, gridVisible: $event === true }" />
              </div>
              <div class="fieldRow">
                <span>网格强度</span>
                <el-slider :modelValue="sceneSettings.gridOpacity" :min="0" :max="1" :step="0.05" aria-label="网格强度" @update:modelValue="$event != null && (sceneSettings = { ...sceneSettings, gridOpacity: Number($event) })" />
              </div>
              <div class="fieldRow">
                <span>地面高度</span>
                <el-slider :modelValue="sceneSettings.groundHeight" :min="-5" :max="5" :step="0.1" aria-label="地面高度" @update:modelValue="$event != null && (sceneSettings = { ...sceneSettings, groundHeight: Number($event) })" />
              </div>
              <div class="fieldRow">
                <span>显示地面</span>
                <el-switch :modelValue="sceneSettings.groundVisible" aria-label="显示地面" @change="sceneSettings = { ...sceneSettings, groundVisible: $event === true }" />
              </div>
            </section>
          </el-tab-pane>
        </el-tabs>
      </aside>
      <transition name="aiDrawer">
        <section v-if="aiPanelOpen" class="aiDrawer" aria-label="导演台助手">
          <el-tabs v-model="aiTab" class="aiDrawerTabs">
            <el-tab-pane label="对话" name="chat">
              <div class="chatTab">
                <slot name="agent" />
                <div class="chatQuickActions">
                  <el-button size="small" :icon="IconPhotoPlus" :disabled="!ready" @click="captureScreenshot">截图到画布</el-button>
                  <el-button size="small" :icon="IconMovie" :disabled="!ready || !result || exportingVideo" :loading="exportingVideo" @click="emit('exportVideo', sceneAspect)">导出白模视频</el-button>
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane :label="`方案 ${plans.length}`" name="plans" lazy>
              <directorPanel
                v-model:prompt="prompt"
                v-model:model="model"
                :result="result"
                :referenceCount="anchors.length"
                :plans="plans"
                :selectedPlanId="selectedPlanId"
                :tasks="tasks"
                :initializing="addingMannequin || !scene.objectList.length && tasks.some(task => !task.error)"
                @selectPlan="selectPlan"
                @duplicatePlan="duplicatePlan"
                :models="models"
                :modelsLoading="modelsLoading"
                @loadModels="emit('loadModels')"
                @send="emit('generate')"
                @editInstruction="emit('editInstruction', $event)"
                readonly />
            </el-tab-pane>
          </el-tabs>
        </section>
      </transition>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Component } from "vue";
import { ElButton, ElCheckbox, ElColorPicker, ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput, ElInputNumber, ElMessage, ElOption, ElOptionGroup, ElPopover, ElSelect, ElSlider, ElSwitch, ElTabPane, ElTabs } from "element-plus";
import {
  IconAlertTriangle, IconArrowBackUp, IconArrowForwardUp, IconArrowUp, IconBox, IconCamera, IconChevronRight, IconCopy, IconCube3dSphere, IconDeviceFloppy, IconEye, IconFileText, IconFocus2, IconGridDots, IconLayoutGrid, IconLayoutSidebar, IconList,
  IconLoader2, IconMovie, IconPhoto, IconPhotoPlus, IconPlayerPause, IconPlayerPlay, IconPlayerTrackPrev, IconPlus, IconPoint, IconPrinter, IconRefresh, IconReload, IconRotateClockwise, IconSearch, IconSparkles, IconTarget,
  IconTrash, IconUpload, IconUser, IconUserPlus, IconUsers, IconX,
} from "@tabler/icons-vue";
import directorPanel from "./directorPanel.vue";
import lightDirection from "./lightDirection.vue";
import { Box3, BoxGeometry, BoxHelper, BufferGeometry, ConeGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Plane, Raycaster, SphereGeometry, TorusGeometry, Vector2, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { getObjectByThreeJsonId, type SceneRuntime } from "threejson/core";
import type { NodeAiModel } from "@toonflow/nodes-scaffold/runtime";
import { groupNodeModels } from "@toonflow/node-shared/groupNodeModels";
import { applyLighting, applySceneSettings, canSyncInPlace, captureCamera, createStage, disposeStage, syncSceneInPlace, type CameraView, type LightingSettings, type SceneDocument, type SceneObject, type SceneSettings } from "./scene";
import { anchorSchema, applyCamera, prepareMotion, sampleMotion, type CameraAnchor } from "./motion";
import { prepareSceneAnimation, type DirectorPlan, type DirectorPlanItem, type DirectorGeneration } from "./sceneAnimation";
import { mannequinPresets } from "./mannequinPresets";
import { propGroups, type PropKind } from "./props";
import { mannequinJoints } from "./mannequin";
import { posePresets } from "./posePresets";
import { colorTemperatures, lightDirections, lightHeights, lightingPresets, normalizeAngle, type LightingPreset } from "./lightPresets";

type ObjectPatch = Partial<Pick<SceneObject, "name" | "position" | "rotation" | "scale" | "pose">> & { color?: string };
const props = defineProps<{
  scene: SceneDocument;
  result?: DirectorPlanItem;
  plans: DirectorPlanItem[];
  selectedPlanId: string;
  tasks: DirectorGeneration[];
  models: NodeAiModel[];
  modelsLoading: boolean;
  addingMannequin: boolean;
  exportingVideo: boolean;
  exportingImage: string;
  exportProgress?: number;
  aiOpen?: boolean;
  backdropUrl?: string;
  uploadingBackdrop?: boolean;
  referenceImage?: string;
  referenceLabel?: string;
  resolveUrl: (path: string) => Promise<string>;
  canUndo?: boolean;
  canRedo?: boolean;
  uploadingModel?: boolean;
}>();
const emit = defineEmits<{
  editInstruction: [value: string];
  selectPlan: [id: string];
  generate: [];
  loadModels: [];
  close: [];
  undo: [];
  redo: [];
  save: [];
  recognizeScene: [];
  addMannequin: [payload?: { pose?: string; preset?: string }];
  addProp: [kind: PropKind];
  addCameraKeyframe: [view: { camera: CameraAnchor["camera"]; controls: CameraAnchor["controls"] }, time: number];
  removeCameraKeyframe: [time: number];
  removeObjectKeyframe: [objectId: string, time: number];
  exportVideo: [aspect: number];
  exportImage: [anchor: CameraAnchor, aspect: number, time: number];
  exportAllAnchors: [aspect: number];
  exportContact: [grid: 9 | 25, aspect: number];
  applyPose: [objectId: string, pose: string];
  removeObject: [objectId: string];
  duplicateObject: [objectId: string];
  updateObject: [objectId: string, patch: ObjectPatch];
  renameObject: [objectId: string, name: string];
  updateScene: [patch: { background?: string }];
  addKeyframe: [objectId: string, time: number];
  removeTrack: [objectId: string, joint?: string];
  addCrowd: [options: { rows: number; cols: number; gap: number; facing: "center" | "fixed"; colored: boolean }];
  exportImageFile: [file: File, aspect: number];
  addPrimitive: [kind: "box" | "sphere" | "cylinder" | "cone" | "torus"];
  uploadBackdrop: [file: File];
  uploadModel: [file: File, objectId?: string];
}>();
const anchors = defineModel<CameraAnchor[]>("anchors", { default: () => [] });
const lighting = defineModel<LightingSettings>("lighting", { required: true });
const sceneSettings = defineModel<SceneSettings>("sceneSettings", { required: true });
const prompt = defineModel<string>("prompt", { default: "" });
const model = defineModel<string>("model", { default: "" });
const shootingAnchorId = defineModel<string>("shootingAnchorId", { default: "" });
const aspectOptions = ["16:9", "9:16", "4:3", "1:1", "2.35:1"];
const transformModeOptions = [
  { value: "translate" as const, label: "移动", shortcut: "G" },
  { value: "rotate" as const, label: "旋转", shortcut: "E" },
  { value: "scale" as const, label: "缩放", shortcut: "S" },
];
const transformMode = ref<"translate" | "rotate" | "scale">("translate");
const guidesVisible = ref(false);
const aiModelGroups = computed(() => groupNodeModels(props.models));
const anchorPreviews = ref<Record<string, string>>({});
const canvas = ref<HTMLCanvasElement>();
const canvasKey = ref(0);
const ready = ref(false);
const stageError = ref("");
const visible = ref(true);
const playing = ref(false);
const aspectRatio = ref("16:9");
const sceneAspect = computed(() => {
  const [width, height] = aspectRatio.value.split(":").map(Number);
  return width! / height!;
});
const currentTime = ref(0);
const focalLength = ref(0);
const activeAnchorId = ref("");
const captureFlash = ref(0);
const viewMode = ref<"director" | "camera">("director");
const aiPanelOpen = ref(props.aiOpen === true);
const aiTab = ref<"chat" | "plans">("chat");
const libraryOpen = ref(false);
function toggleAiPanel() {
  aiPanelOpen.value = !aiPanelOpen.value;
  if (aiPanelOpen.value) aiTab.value = "chat";
}
const uploadingBackdrop = computed(() => props.uploadingBackdrop === true);
const backdropInput = ref<HTMLInputElement>();
const modelInput = ref<HTMLInputElement>();
const replaceObjectId = ref("");
const addPose = ref("自然站立");
const addPreset = ref(mannequinPresets[0]!.name);
const crowd = reactive({ rows: 2, cols: 3, gap: 1.2, facing: "center" as "center" | "fixed", colored: true });
const lookTarget = ref("");
const activeAnchor = computed(() => anchors.value.find(anchor => anchor.id === activeAnchorId.value));
// ACT: 拍摄机位作为机位预览的默认镜头：没有手动选中机位时优先用它。
const preferredAnchor = computed(() => activeAnchor.value ?? anchors.value.find(anchor => anchor.id === shootingAnchorId.value) ?? anchors.value[0]);
const timedAnchors = computed(() => anchors.value.filter(anchor => anchor.time !== undefined && props.result && anchor.time <= props.result.duration));
const cursorPercent = computed(() => (props.result ? Math.min(100, Math.max(0, currentTime.value / props.result.duration * 100)) : 0));
// ACT: 时间轴同时标出物体关键帧，方便对照机位与动画节拍。
const keyframeMarks = computed(() => {
  const duration = props.result?.duration || 0;
  if (!duration) return [];
  const marks: { key: string; name: string; time: number; percent: number }[] = [];
  for (const track of props.result?.tracks ?? []) {
    const object = props.scene.objectList.find(item => item.threeJsonId === track.objectId);
    for (const frame of track.frames) {
      if (frame.time <= 0 || frame.time >= duration) continue;
      marks.push({ key: `${track.objectId}:${track.joint ?? ""}:${frame.time}`, name: `${object?.name ?? "物体"}${track.joint ? `·${track.joint}` : ""}`, time: frame.time, percent: frame.time / duration * 100 });
    }
  }
  return marks.slice(0, 400);
});
const objectTrackCount = computed(() => props.result?.tracks.length ?? 0);
const objectFrameCount = computed(() => (props.result?.tracks ?? []).reduce((total, track) => total + track.frames.length, 0));
// ACT: 轨道面板按“全场景 / 机位 / 镜头”分组，点击直接跳到对应时间，便于对照动作与运镜节拍。
const objectTrackSummaries = computed(() => (props.result?.tracks ?? []).map(track => {
  const object = props.scene.objectList.find(item => item.threeJsonId === track.objectId);
  return {
    key: `${track.objectId}:${track.joint ?? ""}`,
    name: `${object?.name ?? "物体"}${track.joint ? ` · ${jointLabels[track.joint]}` : ""}`,
    frames: track.frames.length,
    start: track.frames[0]?.time ?? 0,
    end: track.frames.at(-1)?.time ?? 0,
  };
}));
// ACT: 镜头关键帧与物体关键帧分色显示，时间轴上能直接看出机位节拍与动作节拍。
const cameraMarks = computed(() => {
  const duration = props.result?.duration || 0;
  if (!duration) return [];
  return (props.result?.cameraFrames ?? []).map((frame, index) => ({
    key: `camera-${index}-${frame.time}`,
    time: frame.time,
    percent: Math.min(100, Math.max(0, frame.time / duration * 100)),
  }));
});
const rulerTicks = computed(() => {
  const duration = props.result?.duration ?? 0;
  if (!duration) return [];
  const step = duration <= 6 ? 1 : duration <= 15 ? 2 : duration <= 30 ? 5 : 10;
  const ticks: { time: number; label: string; percent: number }[] = [];
  for (let time = 0; time <= duration + 0.001; time += step) {
    ticks.push({ time, label: `${Number.isInteger(time) ? time : time.toFixed(1)}s`, percent: Math.min(100, time / duration * 100) });
  }
  return ticks;
});
const cameraKeyframeAtCurrent = computed(() => (props.result?.cameraFrames ?? []).some(frame => Math.abs(frame.time - currentTime.value) < 0.02));
const objectKeyframeAtCurrent = computed(() => {
  const id = selectedObjectId.value;
  if (!id) return false;
  return (props.result?.tracks ?? []).some(track => track.objectId === id && track.frames.some(frame => Math.abs(frame.time - currentTime.value) < 0.02));
});
const primitives: { kind: "box" | "sphere" | "cylinder" | "cone" | "torus"; label: string }[] = [
  { kind: "box", label: "长方体" },
  { kind: "sphere", label: "球体" },
  { kind: "cylinder", label: "圆柱" },
  { kind: "cone", label: "圆锥" },
  { kind: "torus", label: "圆环" },
];
const jointLabels: Record<typeof mannequinJoints[number], string> = {
  hips: "髋部", spine: "脊柱", neck: "颈部", head: "头部",
  leftShoulder: "左肩", leftElbow: "左肘", leftWrist: "左腕", rightShoulder: "右肩", rightElbow: "右肘", rightWrist: "右腕",
  leftHip: "左腿", leftKnee: "左膝", leftAnkle: "左踝", rightHip: "右腿", rightKnee: "右膝", rightAnkle: "右踝",
};
let runtime: SceneRuntime | undefined;
let loadedScene: SceneDocument | undefined;
let loadedPlanKey = "";
let loadedPlanId = "";
let controls: OrbitControls | undefined;
let scenePlayer: ReturnType<typeof prepareSceneAnimation> | undefined;
let cameraFrames: ReturnType<typeof prepareMotion> | undefined;
let previousFrame = 0;
let loadVersion = 0;
let disposed = false;
let previewPlanId = "";
let directorCameraState: ReturnType<typeof captureCamera> | undefined;
let transformControls: TransformControls | undefined;
let transformHelper: Object3D | undefined;
let gizmoDragging = false;
let gizmoDraggedAt = 0;
let yawRing: Group | undefined;
let ringDrag: { objectId: string; target: Object3D; startAngle: number; startYaw: number; center: Vector3 } | undefined;
let ringDraggedAt = 0;
const ringPlane = new Plane();
const ringPoint = new Vector3();
const ringCenter = new Vector3();
const yawRingAvailable = computed(() => ready.value && viewMode.value === "director" && transformMode.value !== "rotate" && selectedObject.value?.objType === "mannequin");
// ACT: 记住导演视角，重载舞台或再次打开编辑器时回到原来的机位，而不是每次编辑都跳回默认视角。
let lastDirectorView: CameraView | undefined;
let lastDirectorTarget: Vector3 | undefined;
const raycaster = new Raycaster();
const pointer = new Vector2();
let downPosition = { x: 0, y: 0 };
const railRefs: Record<string, { hide?: () => void } | undefined> = {};
const gizmos = new Map<string, Group>();

function setRailRef(kind: string, el: unknown) {
  railRefs[kind] = el as { hide?: () => void } | undefined;
}
function showRail(kind: string) {
  railRefs[kind]?.hide?.();
}
function fileName(path: string) {
  const match = path.match(/([^/\\]+)$/);
  return match?.[1] ?? path;
}

// ---------- 左侧场景树与选中物体 ----------
const keyword = ref("");
const panelTab = ref<"object" | "anchor" | "scene">("object");
const objectTab = ref<"props" | "pose" | "track">("props");
const selectedObjectId = ref("");
const openGroups = reactive(new Set(["mannequin", "model", "primitive", "anchor"]));
const jointName = ref<typeof mannequinJoints[number]>("head");
const jointAxes = [{ key: "x", label: "X 轴" }, { key: "y", label: "Y 轴" }, { key: "z", label: "Z 轴" }] as const;
let selectionHelper: BoxHelper | undefined;
const selectedObject = computed(() => props.scene.objectList.find(object => object.threeJsonId === selectedObjectId.value));
const selectedId = computed(() => (viewMode.value === "camera" ? activeAnchorId.value : selectedObjectId.value || activeAnchorId.value));
const activePoseName = computed(() => posePresets.find(preset => JSON.stringify(preset.pose) === JSON.stringify(selectedObject.value?.pose ?? {}))?.name ?? "");
const typeNames: Record<string, string> = { box: "长方体", sphere: "球体", cylinder: "圆柱", cone: "圆锥", torus: "圆环", ring: "圆环", capsule: "胶囊", plane: "平面", model: "模型" };
const objectGroups = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  const match = (name: string) => !query || name.toLowerCase().includes(query);
  const library = (predicate: (object: SceneObject) => boolean) => props.scene.objectList.filter(object => predicate(object) && match(object.name ?? typeNames[object.objType] ?? object.objType));
  const item = (object: SceneObject) => ({ kind: "object" as const, id: object.threeJsonId, name: object.name ?? typeNames[object.objType] ?? object.objType });
  return [
    { key: "mannequin", label: "角色", icon: IconUserPlus as Component, items: library(object => object.objType === "mannequin").map(item) },
    { key: "model", label: "模型", icon: IconUpload as Component, items: library(object => object.objType === "model").map(item) },
    { key: "primitive", label: "几何体", icon: IconBox as Component, items: library(object => object.objType !== "mannequin" && object.objType !== "model").map(item) },
    { key: "anchor", label: "机位", icon: IconCamera as Component, items: anchors.value.filter(anchor => match(anchor.name ?? "机位")).map(anchor => ({ kind: "anchor" as const, id: anchor.id, name: anchor.name ?? "机位", anchor })) },
  ];
});
const objectTracks = computed(() => (props.result?.tracks ?? []).filter(track => track.objectId === selectedObjectId.value).map(track => ({
  key: `${track.objectId}:${track.joint ?? ""}`,
  joint: track.joint,
  label: track.joint ? `关节 · ${jointLabels[track.joint]}` : "整体位移 / 旋转 / 缩放",
  frames: track.frames,
  start: track.frames[0]?.time ?? 0,
  end: track.frames.at(-1)?.time ?? 0,
})));
const pipAnchor = computed(() => preferredAnchor.value);

function toggleGroup(key: string) {
  if (openGroups.has(key)) openGroups.delete(key);
  else openGroups.add(key);
}
const draftName = ref("");
watch([() => selectedObject.value?.threeJsonId, () => selectedObject.value?.name, panelTab], () => { draftName.value = selectedObject.value?.name ?? ""; }, { immediate: true });
function commitName() {
  const object = selectedObject.value;
  const name = draftName.value.trim();
  if (!object || !name || name === object.name) return;
  emit("renameObject", object.threeJsonId, name);
}
function round(value: number) {
  return Math.round(value * 100) / 100;
}
function toDegree(value = 0) {
  return Math.round(value * 180 / Math.PI);
}
function commitVector(kind: "position" | "scale", key: "x" | "y" | "z" | "scaleX" | "scaleY" | "scaleZ", value: number | undefined) {
  const object = selectedObject.value;
  if (!object || value === undefined || !Number.isFinite(value)) return;
  if (kind === "position") {
    const { x, y, z } = object.position;
    emit("updateObject", object.threeJsonId, { position: { x, y, z, [key]: value } as SceneObject["position"] });
  } else {
    const scale = { scaleX: object.scale?.scaleX ?? 1, scaleY: object.scale?.scaleY ?? 1, scaleZ: object.scale?.scaleZ ?? 1 };
    emit("updateObject", object.threeJsonId, { scale: { ...scale, [key]: value } });
  }
}
function commitRotation(key: "rotationX" | "rotationY" | "rotationZ", value: number | undefined) {
  const object = selectedObject.value;
  if (!object || value === undefined || !Number.isFinite(value)) return;
  const rotation = { rotationX: object.rotation?.rotationX ?? 0, rotationY: object.rotation?.rotationY ?? 0, rotationZ: object.rotation?.rotationZ ?? 0 };
  emit("updateObject", object.threeJsonId, { rotation: { ...rotation, [key]: value * Math.PI / 180 } });
}
function commitUniformScale(value: number) {
  const object = selectedObject.value;
  if (!object || !Number.isFinite(value) || value <= 0) return;
  emit("updateObject", object.threeJsonId, { scale: { scaleX: value, scaleY: value, scaleZ: value } });
}
function jointValue(axis: "x" | "y" | "z") {
  return toDegree(selectedObject.value?.pose?.[jointName.value]?.[axis] ?? 0);
}
function commitJoint(axis: "x" | "y" | "z", value: number) {
  const object = selectedObject.value;
  if (!object) return;
  const previous = object.pose?.[jointName.value] ?? { x: 0, y: 0, z: 0 };
  const radian = value * Math.PI / 180;
  emit("updateObject", object.threeJsonId, { pose: { ...object.pose, [jointName.value]: { ...previous, [axis]: radian } } });
}
watch(selectedObjectId, () => { if (selectedObject.value && objectTab.value === "pose" && selectedObject.value.objType !== "mannequin") objectTab.value = "props"; });
watch(viewMode, () => { if (viewMode.value === "camera") panelTab.value = "anchor"; });
watch(() => props.aiOpen, value => { if (value) { aiPanelOpen.value = true; aiTab.value = "chat"; } });
watch(keyword, value => {
  if (!value.trim()) return;
  for (const key of ["mannequin", "model", "primitive", "anchor"]) openGroups.add(key);
});

function selectObject(objectId: string) {
  activeAnchorId.value = "";
  selectedObjectId.value = objectId;
  panelTab.value = "object";
  if (viewMode.value === "camera") setViewMode("director");
  syncSelectionHelper();
  syncTransformAttachment();
  runtime?.invalidate();
}
function clearSelection() {
  selectedObjectId.value = "";
  activeAnchorId.value = "";
  syncSelectionHelper();
  syncTransformAttachment();
  runtime?.invalidate();
}
function syncSelectionHelper() {
  if (!runtime) return;
  syncYawRing();
  if (selectionHelper) {
    runtime.scene.remove(selectionHelper);
    selectionHelper.geometry.dispose();
    (selectionHelper.material as LineBasicMaterial).dispose();
    selectionHelper = undefined;
  }
  const object = selectedObject.value ? getObjectByThreeJsonId(selectedObject.value.threeJsonId, runtime.scene) : undefined;
  if (!object || viewMode.value === "camera") return;
  selectionHelper = new BoxHelper(object, 0xfacc15);
  selectionHelper.userData.tag = "directorHelper";
  runtime.scene.add(selectionHelper);
}

// ---------- 变换工具（移动 / 旋转 / 缩放） ----------
function setTransformMode(mode: "translate" | "rotate" | "scale") {
  transformMode.value = mode;
  if (transformControls && transformControls.object && !transformControls.object.userData.anchorId) {
    transformControls.setMode(mode);
    transformControls.setSpace(mode === "translate" ? "world" : "local");
  }
  syncYawRing();
  runtime?.invalidate();
}
function syncTransformAttachment() {
  if (!transformControls) return;
  const sceneTarget = selectedObject.value && viewMode.value === "director" && ready.value
    ? getObjectByThreeJsonId(selectedObject.value.threeJsonId, runtime!.scene)
    : undefined;
  // ACT: 机位在导演视角下也接入同一套变换手柄，拖动红绿蓝箭头即可沿 XYZ 移动机位。
  const cameraTarget = !sceneTarget && viewMode.value === "director" && ready.value && activeAnchor.value
    ? gizmos.get(activeAnchor.value.id)
    : undefined;
  const target = sceneTarget ?? cameraTarget;
  if (target) {
    transformControls.attach(target);
    transformControls.setSize(sceneTarget ? 0.9 : 0.72);
    transformControls.setMode(sceneTarget ? transformMode.value : "translate");
    transformControls.setSpace(sceneTarget && transformMode.value !== "translate" ? "local" : "world");
  } else {
    transformControls.detach();
  }
  if (transformHelper) transformHelper.visible = !!target;
  runtime?.invalidate();
}
// ACT: 拖动过程中只改 Object3D，松手后一次性提交文档，避免每一帧都触发落盘与整场景校验。
function commitTransform() {
  const target = transformControls?.object;
  if (!target || !runtime) return;
  const anchorId = target.userData.anchorId;
  if (anchorId) {
    const anchor = anchors.value.find(item => item.id === String(anchorId));
    if (!anchor) return;
    const dx = target.position.x - anchor.camera.position.x;
    const dy = target.position.y - anchor.camera.position.y;
    const dz = target.position.z - anchor.camera.position.z;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 0.0001) return;
    anchor.camera = { ...anchor.camera, position: { x: round(target.position.x), y: round(target.position.y), z: round(target.position.z) } };
    anchor.controls = { target: { x: round(anchor.controls.target.x + dx), y: round(anchor.controls.target.y + dy), z: round(anchor.controls.target.z + dz) } };
    anchors.value = [...anchors.value];
    scheduleThumbnails();
    runtime.invalidate();
    return;
  }
  const object = selectedObject.value;
  if (!object) return;
  emit("updateObject", object.threeJsonId, {
    position: { x: round(target.position.x), y: round(target.position.y), z: round(target.position.z) },
    rotation: { rotationX: target.rotation.x, rotationY: target.rotation.y, rotationZ: target.rotation.z },
    scale: { scaleX: round(target.scale.x), scaleY: round(target.scale.y), scaleZ: round(target.scale.z) },
  });
}

// ---------- 人物旋转圆环 ----------
// ACT: 参考 LibTV 导演台的交互，在人物脚下放一个可拖拽圆环，单独控制朝向，避免进入旋转模式才能转人。
function ensureYawRing() {
  if (yawRing || !runtime) return;
  const group = new Group();
  group.userData.tag = "directorHelper";
  const ring = new Mesh(new TorusGeometry(0.66, 0.012, 8, 72), new MeshBasicMaterial({ color: "#e8edf5", transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  const hit = new Mesh(new TorusGeometry(0.66, 0.09, 6, 48), new MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }));
  hit.rotation.x = Math.PI / 2;
  group.add(hit);
  const handle = new Mesh(new SphereGeometry(0.055, 16, 12), new MeshBasicMaterial({ color: "#fbbf24" }));
  // 手柄放在 45° 方向，避开变换手柄的 X / Z 轴箭头。
  handle.position.set(0.66 * Math.cos(Math.PI / 4), 0, 0.66 * Math.sin(Math.PI / 4));
  group.add(handle);
  group.visible = false;
  runtime.scene.add(group);
  yawRing = group;
}
function updateYawRingTransform() {
  if (!yawRing?.visible || !runtime || !selectedObject.value) return;
  const target = getObjectByThreeJsonId(selectedObject.value.threeJsonId, runtime.scene);
  if (!target) return;
  target.getWorldPosition(ringCenter);
  yawRing.position.set(ringCenter.x, ringCenter.y + 0.02, ringCenter.z);
  yawRing.rotation.y = target.rotation.y;
}
function syncYawRing() {
  if (!runtime) return;
  ensureYawRing();
  if (!yawRing) return;
  yawRing.visible = yawRingAvailable.value;
  if (yawRing.visible) updateYawRingTransform();
  runtime.invalidate();
}
function startRingDrag(event: PointerEvent) {
  if (!yawRing?.visible || !runtime || !canvas.value || event.button !== 0) return false;
  const object = selectedObject.value;
  if (!object) return false;
  const target = getObjectByThreeJsonId(object.threeJsonId, runtime.scene);
  if (!target) return false;
  const rect = canvas.value.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, runtime.camera);
  if (!raycaster.intersectObjects(yawRing.children, false).length) return false;
  target.getWorldPosition(ringCenter);
  ringPlane.set(new Vector3(0, 1, 0), -ringCenter.y);
  if (!raycaster.ray.intersectPlane(ringPlane, ringPoint)) return false;
  ringDrag = {
    objectId: object.threeJsonId,
    target,
    center: ringCenter.clone(),
    startAngle: Math.atan2(ringPoint.x - ringCenter.x, ringPoint.z - ringCenter.z),
    startYaw: target.rotation.y,
  };
  if (controls) controls.enabled = false;
  if (transformControls) transformControls.enabled = false;
  if (transformHelper) transformHelper.visible = false;
  runtime.invalidate();
  return true;
}
function moveRingDrag(event: PointerEvent) {
  if (!ringDrag || !runtime || !canvas.value) return;
  const rect = canvas.value.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, runtime.camera);
  ringPlane.set(new Vector3(0, 1, 0), -ringDrag.center.y);
  if (!raycaster.ray.intersectPlane(ringPlane, ringPoint)) return;
  const angle = Math.atan2(ringPoint.x - ringDrag.center.x, ringPoint.z - ringDrag.center.z);
  let delta = angle - ringDrag.startAngle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  let yaw = ringDrag.startYaw + delta;
  // 按住 Shift 以 15° 为步长对齐朝向，便于正面 / 侧面构图。
  if (event.shiftKey) yaw = Math.round(yaw / (Math.PI / 12)) * (Math.PI / 12);
  ringDrag.target.rotation.y = yaw;
  if (yawRing) yawRing.rotation.y = yaw;
  runtime.invalidate();
}
function finishRingDrag() {
  if (!ringDrag) return;
  const { objectId, target, startYaw } = ringDrag;
  const changed = Math.abs(target.rotation.y - startYaw) > 0.0005;
  ringDrag = undefined;
  ringDraggedAt = performance.now();
  if (controls) controls.enabled = viewMode.value === "director";
  if (transformControls) transformControls.enabled = true;
  if (changed) emit("updateObject", objectId, { rotation: { rotationX: target.rotation.x, rotationY: target.rotation.y, rotationZ: target.rotation.z } });
  syncTransformAttachment();
  syncYawRing();
}
function onRingPointerMove(event: PointerEvent) {
  if (ringDrag) moveRingDrag(event);
}
function onRingPointerUp() {
  if (ringDrag) finishRingDrag();
}
function disposeYawRing() {
  if (!yawRing) return;
  if (runtime) runtime.scene.remove(yawRing);
  yawRing.traverse(child => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      (child.material as MeshBasicMaterial).dispose();
    }
  });
  yawRing = undefined;
  ringDrag = undefined;
}

// ---------- 坐标轴 gizmo 与相机方位 ----------
const axisList = ["x", "y", "z"] as const;
const axisVectors = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const axes = reactive<Record<string, { x: number; y: number; depth: number }>>(
  Object.fromEntries([...axisList, ...axisList.map(axis => `-${axis}`)].map(key => [key, { x: 36, y: 36, depth: 0 }])),
);
const sortedAxes = computed(() => Object.entries(axes).map(([key, value]) => ({ key, ...value, negative: key.startsWith("-") })).sort((a, b) => a.depth - b.depth));
const axisScratch = new Vector3();
const axisQuaternion = { x: 0, y: 0, z: 0, w: 1 };
// ACT: 相机朝向的方位角，用于把光位预设换算成“顺光 / 侧光 / 逆光”。
const cameraAzimuth = ref(0);
const referenceAzimuth = computed(() => normalizeAngle(cameraAzimuth.value + 180));
function updateAxisGizmo() {
  if (!runtime) return;
  const quaternion = runtime.camera.quaternion;
  if (quaternion.x === axisQuaternion.x && quaternion.y === axisQuaternion.y && quaternion.z === axisQuaternion.z && quaternion.w === axisQuaternion.w) return;
  Object.assign(axisQuaternion, { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
  const inverse = quaternion.clone().invert();
  for (const axis of axisList) {
    for (const sign of [1, -1]) {
      axisScratch.copy(axisVectors[axis]).multiplyScalar(sign).applyQuaternion(inverse);
      const key = sign > 0 ? axis : `-${axis}`;
      const length = 26 * (0.6 + 0.4 * (1 - Math.max(0, axisScratch.z)));
      axes[key]!.x = 36 + axisScratch.x * length;
      axes[key]!.y = 36 - axisScratch.y * length;
      axes[key]!.depth = axisScratch.z;
    }
  }
  const direction = runtime.camera.getWorldDirection(axisScratch);
  cameraAzimuth.value = normalizeAngle(Math.atan2(direction.x, direction.z) * 180 / Math.PI);
}

// ---------- 光照 ----------
const lightAzimuth = computed({ get: () => lighting.value.azimuth, set: (value: number) => updateLighting({ azimuth: value }) });
const lightElevation = computed({ get: () => lighting.value.elevation, set: (value: number) => updateLighting({ elevation: value }) });
function isActiveLight(offset: number, elevation: number) {
  const delta = Math.abs(((lighting.value.azimuth - referenceAzimuth.value - offset) % 360 + 540) % 360 - 180);
  return delta < 15 && Math.abs(lighting.value.elevation - elevation) < 12;
}
function applyPreset(preset: LightingPreset) {
  updateLighting({ ...preset.patch, azimuth: normalizeAngle(referenceAzimuth.value + preset.offset) });
}
function applyLightPosition(offset: number, elevation: number) {
  updateLighting({ azimuth: normalizeAngle(referenceAzimuth.value + offset), elevation, sunEnabled: true });
}
function updateLighting(value: Partial<LightingSettings>) {
  lighting.value = { ...lighting.value, ...value };
}
let thumbnailTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleThumbnails() {
  clearTimeout(thumbnailTimer);
  thumbnailTimer = setTimeout(() => { if (!disposed && runtime && ready.value) void refreshThumbnails(); }, 140);
}
watch(lighting, value => {
  if (!runtime) return;
  applyLighting(runtime, value);
  scheduleThumbnails();
});
watch(sceneSettings, value => {
  if (!runtime) return;
  applySceneSettings(runtime, { ...value, backdropPath: props.backdropUrl || undefined });
  scheduleThumbnails();
});
// 背景图异步读成 URL 后再刷新舞台贴图。
watch(() => props.backdropUrl, () => {
  if (runtime) applySceneSettings(runtime, { ...sceneSettings.value, backdropPath: props.backdropUrl || undefined });
  scheduleThumbnails();
});

// ---------- 视角工具 ----------
const orbiting = ref(false);
const cameraPrompt = ref("");
function toggleOrbit() {
  if (!controls) return;
  orbiting.value = !orbiting.value;
  controls.autoRotate = orbiting.value;
  controls.autoRotateSpeed = 1.2;
  if (orbiting.value) runtime?.invalidate();
}
function frontView() {
  if (!runtime) return;
  if (viewMode.value !== "director") setViewMode("director");
  toggleOrbitOff();
  const target = focusTarget();
  const distance = Math.max(4, runtime.camera.position.distanceTo(controls?.target ?? target));
  runtime.camera.position.set(target.x, target.y + distance * 0.25, target.z + distance);
  if (controls) { controls.target.copy(target); controls.update(); }
  runtime.camera.lookAt(target);
  runtime.camera.updateProjectionMatrix();
  focalLength.value = runtime.camera.getFocalLength();
  rememberDirectorView();
  runtime.invalidate();
}
function focusTarget() {
  const object = selectedObject.value;
  if (object) return new Vector3(object.position.x, object.position.y + 0.9, object.position.z);
  const { target } = props.scene.sceneConfig.controls;
  return new Vector3(target.x, target.y, target.z);
}
function resetView() {
  if (!runtime) return;
  if (viewMode.value !== "director") setViewMode("director");
  toggleOrbitOff();
  const { camera, controls: view } = props.scene.sceneConfig;
  runtime.camera.position.set(camera.position.x, camera.position.y, camera.position.z);
  if (controls) { controls.target.set(view.target.x, view.target.y, view.target.z); controls.update(); }
  runtime.camera.lookAt(view.target.x, view.target.y, view.target.z);
  runtime.camera.updateProjectionMatrix();
  focalLength.value = runtime.camera.getFocalLength();
  rememberDirectorView();
  runtime.invalidate();
}
function toggleOrbitOff() {
  orbiting.value = false;
  if (controls) controls.autoRotate = false;
}
function sendCameraPrompt() {
  const text = cameraPrompt.value.trim();
  if (!text) return;
  emit("editInstruction", text);
  aiPanelOpen.value = true;
  cameraPrompt.value = "";
  emit("generate");
}
function rememberDirectorView() {
  if (!runtime || viewMode.value !== "director") return;
  lastDirectorView = captureCamera(runtime);
  lastDirectorTarget = controls?.target.clone();
}

// ---------- 快捷键 ----------
// ACT: 焦点在输入框 / 富文本 / 下拉里时不拦截，避免与打字冲突；对话框卸载时监听自动移除。
function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
}
function onShortcut(event: KeyboardEvent) {
  if (!visible.value || !ready.value || isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (key === "z") { event.preventDefault(); event.shiftKey ? emit("redo") : emit("undo"); }
    else if (key === "y") { event.preventDefault(); emit("redo"); }
    return;
  }
  if (event.altKey) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    if (!selectedObject.value) return;
    event.preventDefault();
    emit("removeObject", selectedObject.value.threeJsonId);
  } else if (key === "f") {
    if (selectedObject.value) focusObject(selectedObject.value.threeJsonId);
  } else if (key === "g") {
    setTransformMode("translate");
  } else if (key === "e") {
    setTransformMode("rotate");
  } else if (key === "s") {
    setTransformMode("scale");
  } else if (key === "r") {
    resetView();
  } else if (event.key === " ") {
    event.preventDefault();
    togglePlayback();
  } else if (event.key === "Escape") {
    clearSelection();
  }
}

// ACT: 方案复制 —— 以选中方案为模板创建变体，保留全部轨道与运镜。
function duplicatePlan(id: string) {
  let doc: { plans?: { id: string; name: string }[] & Record<string, unknown>[] };
  try {
    doc = JSON.parse(model.value || "{}");
  } catch { return; }
  const list = Array.isArray(doc.plans) ? doc.plans : [];
  const index = list.findIndex(plan => plan.id === id);
  if (index < 0) return;
  const copy = JSON.parse(JSON.stringify(list[index])) as { id: string; name: string };
  copy.id = crypto.randomUUID();
  copy.name = `${String(list[index].name).slice(0, 72)} 副本`;
  list.splice(index + 1, 0, copy);
  model.value = JSON.stringify(doc);
  ElMessage.success("已创建方案副本");
}

const exportingBoard = ref(false);
async function exportStoryboard(target: "print" | "html" = "html") {
  if (!ready.value || !runtime || !canvas.value || !props.plans.length) return;
  pausePlayback();
  exportingBoard.value = true;
  try {
    const cards: { name: string; duration: number; time: number; thumb: string; instruction: string; times: string; easings: string }[] = [];
    for (const plan of props.plans) {
      const player = prepareSceneAnimation(runtime, plan);
      const frames = prepareMotion(plan.cameraFrames);
      const time = Math.max(0, Math.min(plan.duration, plan.duration * 0.85));
      player.setTime(time);
      sampleMotion(runtime.camera, frames, time);
      const thumb = withHelpersHidden(() => {
        runtime!.renderer.render(runtime!.scene, runtime!.camera);
        return canvas.value!.toDataURL("image/jpeg", 0.82);
      });
      player.dispose();
      cards.push({ name: plan.name, duration: plan.duration, time, thumb, instruction: (plan as { instruction?: string }).instruction ?? "", times: plan.cameraFrames.map(frame => frame.time.toFixed(2)).join(" → "), easings: plan.cameraFrames.map(frame => frame.easing).join("→") });
    }
    restorePreviewFrame();
    const stamp = new Date().toISOString().slice(0, 10);
    const body = cards.map((card, index) => `
      <section class="boardCard">
        <div class="boardHead"><span class="boardIndex">#${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(card.name)}</h2><span class="boardDuration">${card.duration.toFixed(2)} 秒</span></div>
        <img src="${card.thumb}" alt="${escapeHtml(card.name)} 画面" />
        <p class="boardCamera"><b>相机关键帧</b> ${escapeHtml(card.times)} 秒 <b>转场</b> ${escapeHtml(card.easings)}</p>
        ${card.instruction ? `<p class="boardInstruction"><b>创作指令</b> ${escapeHtml(card.instruction)}</p>` : ""}
      </section>`).join("\n");
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>导演台分镜板 ${stamp}</title><style>
      body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; margin: 24px auto; max-width: 960px; color: #1f2329; }
      h1 { font-size: 20px; } small { color: #86909c; }
      .boardCard { page-break-inside: avoid; border: 1px solid #dcdfe6; border-radius: 12px; padding: 16px; margin: 16px 0; }
      .boardHead { display: flex; align-items: baseline; gap: 10px; } .boardIndex { color: #86909c; }
      h2 { font-size: 16px; margin: 0; } .boardDuration { margin-left: auto; font-variant-numeric: tabular-nums; }
      img { width: 100%; border-radius: 8px; }
      p { font-size: 13px; line-height: 1.7; } b { color: #4e5969; font-weight: 500; }
      @media print { body { margin: 0; } .boardCard { border-color: #e5e6eb; } }
    </style></head><body><h1>导演台分镜板</h1><small>生成于 ${new Date().toLocaleString("zh-CN")} · 共 ${cards.length} 个方案 · 浏览器打印（Ctrl+P）可另存为 PDF</small>${body}</body></html>`;
    if (target === "print") {
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.append(frame);
      frame.contentDocument!.open();
      frame.contentDocument!.write(html + "<script>window.onload=()=>{setTimeout(()=>{window.focus();window.print();},300);};<\/script>");
      frame.contentDocument!.close();
      frame.contentWindow!.onafterprint = () => window.setTimeout(() => frame.remove(), 800);
      window.setTimeout(() => frame.remove(), 120000);
    } else {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `导演台分镜板-${stamp}.html`;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    ElMessage.success(target === "print" ? "分镜板已就绪，请在打印对话框选择「另存为 PDF」" : "分镜板 HTML 已下载");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "分镜板导出失败");
  } finally {
    exportingBoard.value = false;
  }
}

function restorePreviewFrame() {
  if (!runtime || !props.result) return;
  scenePlayer?.dispose();
  scenePlayer = prepareSceneAnimation(runtime, props.result);
  scenePlayer.setTime(Math.min(currentTime.value, props.result.duration));
  if (viewMode.value === "camera" && cameraFrames) sampleMotion(runtime.camera, cameraFrames, Math.min(currentTime.value, props.result.duration));
  withHelpersHidden(() => runtime!.renderer.render(runtime!.scene, runtime!.camera));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

// ACT: 截图、缩略图、分镜板都不应带出相机模型与选中框；渲染期间临时隐藏辅助体，结束后恢复。
function withHelpersHidden<T>(render: () => T): T {
  const helpers = ([selectionHelper, transformHelper, yawRing, ...gizmos.values()] as (Object3D | undefined)[]).filter((helper): helper is Object3D => !!helper);
  const visibility = helpers.map(helper => helper.visible);
  helpers.forEach(helper => { helper.visible = false; });
  try {
    return render();
  } finally {
    helpers.forEach((helper, index) => { helper.visible = visibility[index]!; });
  }
}

async function selectPlan(id: string) {
  previewPlanId = id;
  emit("selectPlan", id);
  await nextTick();
  previewSelectedPlan();
}

function previewSelectedPlan() {
  if (disposed || !ready.value || !props.result || previewPlanId !== props.selectedPlanId) return;
  previewPlanId = "";
  currentTime.value = 0;
  pausePlayback();
  togglePlayback();
}

// ACT: 模型路径先换成可加载的 blob URL，再交给舞台；任一模型读不到就整体报错，不出半截场景。
async function resolveStageScene(scene: SceneDocument): Promise<SceneDocument> {
  const models = scene.objectList.filter(object => object.model);
  if (!models.length) return scene;
  const urls = await Promise.all(models.map(async object => {
    try {
      return await props.resolveUrl(object.model!.path);
    } catch {
      throw new Error(`模型「${object.name ?? "未命名模型"}」的文件读取失败，请删除后重新上传`);
    }
  }));
  return { ...scene, objectList: scene.objectList.map(object => {
    const index = models.indexOf(object);
    return index < 0 ? object : { ...object, model: { path: urls[index]! } };
  }) };
}

// ACT: resetView 用于场景默认机位被改写（如加入首个物体后自动拉近）或历史回退，此时不再沿用旧视角。
async function loadScene(options: { resetView?: boolean } = {}) {
  if (!canvas.value) return;
  const version = ++loadVersion;
  const source = props.scene;
  if (options.resetView) {
    lastDirectorView = undefined;
    lastDirectorTarget = undefined;
    directorCameraState = undefined;
  } else {
    rememberDirectorView();
  }
  const keepAnchorId = activeAnchorId.value;
  const keepView = viewMode.value;
  ready.value = false;
  stageError.value = "";
  playing.value = false;
  activeAnchorId.value = anchors.value.some(anchor => anchor.id === keepAnchorId) ? keepAnchorId : "";
  releaseStage();
  canvasKey.value = version;
  try {
    const scene = await resolveStageScene(source);
    await nextTick();
    if (disposed || version !== loadVersion || !canvas.value) return;
    const next = await createStage(canvas.value, scene, updateFrame, sceneAspect.value, lighting.value, { ...sceneSettings.value, backdropPath: props.backdropUrl || undefined });
    if (disposed || version !== loadVersion) return disposeStage(next);
    runtime = next;
    // ACT: threejson 运行时自带的 OrbitControls 每帧都会 lookAt 自己的 target，
    // 会把机位的摇摄 / 俯仰 / 滚转拉回场景默认朝向；编辑器用的是下面自建的控制器，这里停掉它的 update。
    // threejson 运行时自带的 OrbitControls 每帧都会 lookAt 自己的 target，会把机位的摇摄 / 俯仰 / 滚转拉回场景默认朝向；
    // 编辑器用的是下面自建的控制器，这里停掉它的 update。
    loadedScene = source;
    updateAspect();
    controls = new OrbitControls(runtime.camera, canvas.value);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = orbiting.value;
    controls.autoRotateSpeed = 1.2;
    const { target } = source.sceneConfig.controls;
    controls.target.set(target.x, target.y, target.z);
    // 回到上次的导演机位；没有记录（首次打开）时沿用场景默认机位。
    if (keepView === "camera") {
      const anchor = preferredAnchor.value;
      if (anchor) applyCamera(runtime.camera, anchor);
      else viewMode.value = "director";
    }
    if (viewMode.value === "director" && lastDirectorView) {
      applyCamera(runtime.camera, lastDirectorView);
      if (lastDirectorTarget) controls.target.copy(lastDirectorTarget);
    }
    // 机位视角下不能在载入后再跑 OrbitControls.update()，否则会把机位朝向拉回导演视角目标。
    if (viewMode.value === "director") controls.update();
    controls.addEventListener("change", () => runtime?.invalidate());
    // ACT: 变换手柄与轨道控制器互斥：拖手柄时禁用轨道控制，拖完再恢复，避免两个控制器同时抢指针。
    transformControls = new TransformControls(runtime.camera, canvas.value);
    transformControls.setSize(0.9);
    transformControls.setMode(transformMode.value);
    transformControls.setSpace(transformMode.value === "translate" ? "world" : "local");
    transformControls.addEventListener("dragging-changed", event => {
      gizmoDragging = event.value === true;
      if (controls) controls.enabled = !gizmoDragging && viewMode.value === "director";
      if (!gizmoDragging) {
        gizmoDraggedAt = performance.now();
        commitTransform();
      }
    });
    transformControls.addEventListener("objectChange", () => {
      selectionHelper?.update();
      runtime?.invalidate();
    });
    transformHelper = transformControls.getHelper();
    transformHelper.userData.tag = "directorHelper";
    runtime.scene.add(transformHelper);
    setAnimation();
    applyLighting(runtime, lighting.value);
    await refreshThumbnails();
    if (disposed || version !== loadVersion) return;
    syncGizmos();
    syncSelectionHelper();
    syncTransformAttachment();
    sampleTime();
    runtime.start();
    ready.value = true;
    syncYawRing();
    previewSelectedPlan();
    // 载入期间文档可能又变了，补一次同步，避免舞台停留在旧内容。
    syncStage();
  } catch (error) {
    if (!disposed && version === loadVersion) {
      releaseStage();
      stageError.value = error instanceof Error ? error.message : "场景载入失败";
    }
  }
}

// ACT: 方案内容变化时重建动画；同一方案内手动加关键帧只刷新轨道，保留当前时间与选中的机位。
function setAnimation(keepTime = false) {
  if (!runtime) return;
  pausePlayback();
  if (!keepTime) activeAnchorId.value = "";
  scenePlayer?.dispose();
  scenePlayer = undefined;
  cameraFrames = undefined;
  loadedPlanKey = props.result ? JSON.stringify(props.result) : "";
  loadedPlanId = props.result?.id ?? "";
  if (props.result) {
    scenePlayer = prepareSceneAnimation(runtime, props.result);
    cameraFrames = prepareMotion(props.result.cameraFrames);
  }
  if (!keepTime || !props.result || currentTime.value > props.result.duration) currentTime.value = 0;
  previousFrame = performance.now();
  sampleTime();
}

function updateFrame() {
  if (playing.value || orbiting.value) runtime?.invalidate();
  updateAxisGizmo();
  if (selectionHelper?.visible) selectionHelper.update();
  if (yawRing?.visible) updateYawRingTransform();
  updateGizmoVisibility();
  const now = performance.now();
  const elapsed = Math.max(0, (now - previousFrame) / 1000);
  previousFrame = now;
  if (playing.value && props.result) {
    currentTime.value = Math.min(props.result.duration, currentTime.value + elapsed);
    sampleTime();
    if (currentTime.value >= props.result.duration) {
      playing.value = false;
      sampleTime();
    }
  }
}

// ACT: 机位视角下——选中机位且未播放时看的是该机位的画面；播放或拖动进度且没有选中机位时，跟随方案的运镜轨迹。
function sampleTime() {
  runtime?.invalidate();
  scenePlayer?.setTime(currentTime.value);
  if (runtime && viewMode.value === "camera") {
    if (activeAnchor.value && !playing.value) applyCamera(runtime.camera, activeAnchor.value);
    else if (cameraFrames) sampleMotion(runtime.camera, cameraFrames, currentTime.value);
  }
  if (runtime) focalLength.value = runtime.camera.getFocalLength();
}

function setViewMode(mode: "director" | "camera") {
  if (!runtime || viewMode.value === mode) return;
  if (mode === "camera") {
    const anchor = preferredAnchor.value;
    if (!anchor) return void ElMessage.warning("请先添加机位，再进入机位视角");
    // 未显式选中机位时，把当前取景机位设为编辑目标，面板与拖动才能改到同一个机位。
    if (!activeAnchor.value) activeAnchorId.value = anchor.id;
    rememberDirectorView();
    directorCameraState = captureCamera(runtime);
    applyCamera(runtime.camera, anchor);
    if (anchor.time !== undefined && props.result) {
      currentTime.value = Math.min(props.result.duration, anchor.time);
      scenePlayer?.setTime(currentTime.value);
    }
    if (controls) controls.enabled = false;
    viewMode.value = "camera";
  } else {
    if (directorCameraState) {
      applyCamera(runtime.camera, directorCameraState);
      if (controls) controls.target.set(directorCameraState.controls.target.x, directorCameraState.controls.target.y, directorCameraState.controls.target.z);
      controls?.update();
    }
    if (controls) controls.enabled = true;
    viewMode.value = "director";
  }
  syncGizmos();
  syncSelectionHelper();
  syncTransformAttachment();
  sampleTime();
}

// ACT: 滚轮按 deltaY 连续缩放（鼠标一格约 17%，触控板按滑动量），比按事件次数缩放更跟手；
// Shift 进入精细模式。导演视角推拉机位，机位视角改焦段，两种视角的放大方向一致（上滚放大）。
const wheelZoomRate = 0.16;
function onWheel(event: WheelEvent) {
  if (!runtime || !ready.value || !event.deltaY) return;
  // 同时拦掉 OrbitControls 自带的滚轮缩放：它是「一次事件一跳」，在高分辨率触控板上会失控。
  event.preventDefault();
  event.stopImmediatePropagation();
  if (viewMode.value === "camera") pausePlayback();
  // Firefox 等浏览器可能以「行 / 页」为单位上报 deltaY，先统一折算成像素再算缩放量。
  const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
  const step = Math.max(-4, Math.min(4, delta / 100)) * (event.shiftKey ? 0.3 : 1);
  const factor = Math.exp(step * wheelZoomRate);
  if (viewMode.value === "camera") {
    // 机位视角上滚 = 拉长焦（放大），和导演视角的推近方向保持一致。
    const current = runtime.camera.getFocalLength();
    runtime.camera.setFocalLength(Math.min(135, Math.max(12, current / factor)));
    focalLength.value = runtime.camera.getFocalLength();
    if (activeAnchor.value) {
      activeAnchor.value.camera = { ...activeAnchor.value.camera, fov: runtime.camera.fov };
      anchors.value = [...anchors.value];
      scheduleThumbnails();
    }
  } else if (controls) {
    // 推拉时保持机位朝向不变，只改机位到轨道目标的距离。
    const offset = runtime.camera.position.clone().sub(controls.target);
    const distance = offset.length();
    if (distance < 0.0001) return;
    const next = Math.min(150, Math.max(0.3, distance * factor));
    runtime.camera.position.copy(controls.target).add(offset.setLength(next));
    controls.update();
    runtime.invalidate();
  }
}

// ACT: 机位视角按住拖动 = 摇镜头 / 俯仰，和真实云台一致；Shift 进入精细模式，松手才写回机位。
function startCameraLook(event: PointerEvent) {
  if (viewMode.value !== "camera" || !runtime || !activeAnchor.value || event.button !== 0) return false;
  const angles = cameraAngles.value;
  cameraLookDrag = { startX: event.clientX, startY: event.clientY, yaw: angles.yaw, pitch: angles.pitch, distance: angles.distance };
  pausePlayback();
  canvas.value?.setPointerCapture?.(event.pointerId);
  return true;
}
function onPointerMove(event: PointerEvent) {
  if (!cameraLookDrag || !runtime) return;
  const scale = cameraLookSensitivity * (event.shiftKey ? 0.28 : 1);
  setAnchorAngles({
    yaw: cameraLookDrag.yaw + (event.clientX - cameraLookDrag.startX) * scale,
    pitch: cameraLookDrag.pitch - (event.clientY - cameraLookDrag.startY) * scale,
  });
}
function finishCameraLook() {
  if (!cameraLookDrag) return false;
  cameraLookDrag = undefined;
  commitAnchorAngles();
  return true;
}

function onPointerDown(event: PointerEvent) {
  downPosition = { x: event.clientX, y: event.clientY };
  if (startRingDrag(event)) {
    event.preventDefault();
    canvas.value?.focus();
    return;
  }
  if (startCameraLook(event)) {
    event.preventDefault();
    canvas.value?.focus();
  }
}

function onPointerUp(event: PointerEvent) {
  if (finishCameraLook()) return;
  if (viewMode.value !== "director" || !runtime || !canvas.value) return;
  if (ringDrag) return;
  // 拖动变换手柄或旋转圆环后不再触发点选，避免松手时把背后的物体或空白当成一次选择。
  if (gizmoDragging || performance.now() - gizmoDraggedAt < 250 || performance.now() - ringDraggedAt < 250) return;
  if (Math.hypot(event.clientX - downPosition.x, event.clientY - downPosition.y) > 4) return;
  if (event.button !== 0) return;
  const rect = canvas.value.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, runtime.camera);
  const bodies = [...gizmos.values()].flatMap(group => group.children.filter(child => child instanceof Mesh && child.userData.anchorId)) as Mesh[];
  const cameraHit = raycaster.intersectObjects(bodies, false)[0];
  if (cameraHit?.object.userData.anchorId) {
    selectedObjectId.value = "";
    activeAnchorId.value = String(cameraHit.object.userData.anchorId);
    panelTab.value = "anchor";
    syncSelectionHelper();
    syncTransformAttachment();
    return;
  }
  const objects = props.scene.objectList.flatMap(object => {
    const target = getObjectByThreeJsonId(object.threeJsonId, runtime!.scene);
    return target ? [target] : [];
  });
  const hit = raycaster.intersectObjects(objects, true)[0];
  let node: Object3D | undefined = hit?.object;
  while (node && !node.userData.threeJsonId) node = node.parent ?? undefined;
  if (node?.userData.threeJsonId) selectObject(String(node.userData.threeJsonId));
  else clearSelection();
}

function buildCameraGizmo(anchor: CameraAnchor) {
  const group = new Group();
  group.userData.anchorId = anchor.id;
  group.userData.tag = "directorHelper";
  const body = new Mesh(new BoxGeometry(0.18, 0.12, 0.26), new MeshBasicMaterial({ color: "#f59e0b" }));
  body.userData.anchorId = anchor.id;
  group.add(body);
  const lens = new Mesh(new ConeGeometry(0.07, 0.18, 12), new MeshBasicMaterial({ color: "#f59e0b" }));
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.2;
  lens.userData.anchorId = anchor.id;
  group.add(lens);
  group.userData.lens = lens;
  group.userData.body = body;
  return group;
}

function updateGizmo(group: Group, anchor: CameraAnchor, index: number, selected: boolean) {
  const position = anchor.camera.position;
  group.position.set(position.x, position.y, position.z);
  const target = new Vector3(anchor.controls.target.x, anchor.controls.target.y, anchor.controls.target.z);
  group.lookAt(target);
  // 机位有滚转（荷兰角）时，模型跟着绕视线倾斜，导演视角里能直接看出构图。
  if (anchor.camera.roll) group.rotateZ(anchor.camera.roll * Math.PI / 180);
  const color = selected ? "#3b82f6" : index % 2 ? "#f59e0b" : "#fbbf24";
  ((group.userData.body as Mesh).material as MeshBasicMaterial).color.set(color);
  ((group.userData.lens as Mesh).material as MeshBasicMaterial).color.set(color);
  const oldLine = group.children.find(child => child.userData.isFrustumLine);
  if (oldLine) {
    group.remove(oldLine);
    (oldLine as Line).geometry.dispose();
  }
  // 组已经 lookAt 目标，线在局部空间直接沿 +Z 画到目标距离即可，不能再旋转一次世界向量。
  const distance = target.distanceTo(new Vector3(position.x, position.y, position.z));
  const geometry = new BufferGeometry().setFromPoints([new Vector3(0, 0, 0.22), new Vector3(0, 0, Math.max(0.4, distance))]);
  const line = new Line(geometry, new LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
  line.userData.isFrustumLine = true;
  group.add(line);
}

function syncGizmos() {
  if (!runtime) return;
  const scene = runtime.scene;
  const ids = new Set(anchors.value.map(anchor => anchor.id));
  for (const [id, group] of gizmos) {
    if (ids.has(id)) continue;
    scene.remove(group);
    disposeGizmo(group);
    gizmos.delete(id);
  }
  anchors.value.forEach((anchor, index) => {
    let group = gizmos.get(anchor.id);
    if (!group) {
      group = buildCameraGizmo(anchor);
      gizmos.set(anchor.id, group);
      scene.add(group);
    }
    updateGizmo(group, anchor, index, anchor.id === activeAnchorId.value);
    group.visible = viewMode.value === "director";
  });
  runtime.invalidate();
}
function disposeGizmo(group: Group) {
  group.traverse(child => {
    if (child instanceof Mesh || child instanceof Line) { child.geometry.dispose(); (child.material as MeshBasicMaterial | LineBasicMaterial).dispose(); }
  });
}
// ACT: 机位默认记录在当前视点，相机模型正好贴在镜头前会把画面整块挡住；镜头离某个机位模型过近时隐藏它，移开后自动恢复。
function updateGizmoVisibility() {
  if (!runtime || !gizmos.size) return;
  const show = viewMode.value === "director";
  const { x, y, z } = runtime.camera.position;
  for (const group of gizmos.values()) {
    const dx = group.position.x - x;
    const dy = group.position.y - y;
    const dz = group.position.z - z;
    const visible = show && dx * dx + dy * dy + dz * dz > 0.36;
    if (group.visible !== visible) group.visible = visible;
  }
}

watch(anchors, () => syncGizmos(), { deep: true });
watch(activeAnchorId, () => { lookTarget.value = ""; syncGizmos(); syncTransformAttachment(); });
watch(viewMode, () => syncGizmos());

function captureScreenshot() {
  if (!runtime) return;
  // 同步读取像素，保证辅助体在读取期间处于隐藏状态。
  const snapshot = withHelpersHidden(() => {
    runtime!.renderer.render(runtime!.scene, runtime!.camera);
    return runtime!.renderer.domElement.toDataURL("image/png");
  });
  if (!snapshot.startsWith("data:image/png;base64,")) return void ElMessage.error("截图失败，请重试");
  captureFlash.value++;
  fetch(snapshot).then(response => response.blob()).then(blob => {
    if (disposed) return;
    emit("exportImageFile", new File([blob], `镜头截图-${new Date().toISOString().slice(11, 19).replaceAll(":", "-")}.png`, { type: "image/png" }), sceneAspect.value);
  }, () => { if (!disposed) ElMessage.error("截图失败，请重试"); });
}

function onBackdropSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return void ElMessage.error("请选择图片文件");
  if (file.size > 12 * 1024 * 1024) return void ElMessage.error("背景图片不能超过 12 MB");
  emit("uploadBackdrop", file);
  (event.target as HTMLInputElement).value = "";
}

function removeBackdrop() {
  const { backdropPath: _removed, ...rest } = sceneSettings.value;
  sceneSettings.value = { ...rest, backdropEnabled: false };
}

function onModelSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  (event.target as HTMLInputElement).value = "";
  const target = replaceObjectId.value;
  replaceObjectId.value = "";
  emit("uploadModel", file, target || undefined);
}

function focusObject(objectId: string) {
  if (!runtime) return;
  const object = getObjectByThreeJsonId(objectId, runtime.scene);
  if (!object) return;
  pausePlayback();
  toggleOrbitOff();
  setViewMode("director");
  selectedObjectId.value = objectId;
  panelTab.value = "object";
  syncSelectionHelper();
  syncTransformAttachment();
  const bounds = new Box3().setFromObject(object);
  const center = bounds.getCenter(new Vector3());
  const radius = Math.max(0.8, bounds.getSize(new Vector3()).length() * 0.55);
  runtime.camera.position.set(center.x + radius * 1.1, center.y + radius * 0.7, center.z + radius * 1.5);
  if (controls) { controls.target.copy(center); controls.update(); }
  runtime.camera.lookAt(center);
  runtime.camera.updateProjectionMatrix();
  activeAnchorId.value = "";
  rememberDirectorView();
  runtime.invalidate();
}

function updateAspect() {
  if (!runtime) return;
  const aspect = sceneAspect.value;
  runtime.renderer.setSize(Math.round(960 * Math.min(1, aspect)), Math.round(960 / Math.max(1, aspect)), false);
  runtime.camera.aspect = aspect;
  runtime.camera.updateProjectionMatrix();
  focalLength.value = runtime.camera.getFocalLength();
}
watch(sceneAspect, () => { if (runtime) { updateAspect(); scheduleThumbnails(); } });

function captureThumbnail() {
  const thumbnail = document.createElement("canvas");
  thumbnail.width = 192;
  thumbnail.height = Math.round(192 / sceneAspect.value);
  return withHelpersHidden(() => {
    runtime!.renderer.render(runtime!.scene, runtime!.camera);
    thumbnail.getContext("2d")!.drawImage(runtime!.renderer.domElement, 0, 0, thumbnail.width, thumbnail.height);
    return thumbnail.toDataURL("image/jpeg", 0.75);
  });
}
// ACT: 机位缩略图与画中画都来自这里；渲染期间隐藏辅助体，并始终保持导演机位不变。
async function refreshThumbnails() {
  if (!runtime) return;
  const view = captureCamera(runtime);
  const target = controls?.target.clone();
  const next: Record<string, string> = {};
  for (const anchor of anchors.value) {
    scenePlayer?.setTime(anchor.time ?? 0);
    applyCamera(runtime.camera, anchor);
    next[anchor.id] = captureThumbnail();
  }
  if (viewMode.value === "camera" && activeAnchor.value && !playing.value) applyCamera(runtime.camera, activeAnchor.value);
  else if (viewMode.value === "camera" && cameraFrames) sampleMotion(runtime.camera, cameraFrames, currentTime.value);
  else applyCamera(runtime.camera, view);
  if (target && controls) {
    controls.target.copy(target);
    // 机位视角下不能调用 OrbitControls.update()：它会按导演视角目标重新 lookAt，把摇摄和滚转拉回去。
    if (viewMode.value === "director") controls.update();
  }
  scenePlayer?.setTime(currentTime.value);
  anchorPreviews.value = next;
  runtime.invalidate();
}

function addAnchor() {
  if (!ready.value || !runtime) return;
  if (anchors.value.length >= 100) return void ElMessage.warning("最多记录 100 个机位");
  pausePlayback();
  const anchor = anchorSchema.parse({ ...captureCamera(runtime), name: `机位 ${anchors.value.length + 1}`, time: currentTime.value });
  anchorPreviews.value = { ...anchorPreviews.value, [anchor.id]: captureThumbnail() };
  anchors.value = [...anchors.value, anchor];
  activeAnchorId.value = anchor.id;
  selectedObjectId.value = "";
  panelTab.value = "anchor";
  captureFlash.value++;
  syncGizmos();
  syncTransformAttachment();
}
function renameAnchor() {
  anchors.value = [...anchors.value];
}
function applyAnchorFov() {
  const anchor = activeAnchor.value;
  if (!anchor || !runtime) return;
  runtime.camera.fov = anchor.camera.fov;
  runtime.camera.updateProjectionMatrix();
  focalLength.value = runtime.camera.getFocalLength();
  if (viewMode.value === "director") anchors.value = [...anchors.value];
  scheduleThumbnails();
  runtime.invalidate();
}
function onCameraSelect(id: string) {
  const anchor = anchors.value.find(item => item.id === id);
  if (anchor) jumpToAnchor(anchor);
}
// ACT: 机位位置 / 朝向目标支持精确数值输入，摆位不再只能靠拖拽和“应用注视”。
function commitAnchorVector(kind: "position" | "target", axis: "x" | "y" | "z", value: number | undefined) {
  const anchor = activeAnchor.value;
  if (!anchor || value === undefined || !Number.isFinite(value)) return;
  if (kind === "position") anchor.camera = { ...anchor.camera, position: { ...anchor.camera.position, [axis]: value } };
  else anchor.controls = { target: { ...anchor.controls.target, [axis]: value } };
  anchors.value = [...anchors.value];
  if (viewMode.value === "camera" && runtime) applyCamera(runtime.camera, anchor);
  scheduleThumbnails();
  runtime?.invalidate();
}
// ---------- 机位拍摄角度（水平 / 俯仰 / 滚转） ----------
// ACT: 拖动画面按「度/像素」换算，和取景器类产品的摇摄手感接近；Shift 进入精细模式。
const cameraLookSensitivity = 0.14;
let cameraLookDrag: { startX: number; startY: number; yaw: number; pitch: number; distance: number } | undefined;
const cameraAngles = computed(() => {
  const anchor = activeAnchor.value;
  if (!anchor) return { yaw: 0, pitch: 0, roll: 0, distance: 1 };
  const { position } = anchor.camera;
  const { target } = anchor.controls;
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dz = target.z - position.z;
  const distance = Math.max(0.01, Math.hypot(dx, dy, dz));
  return {
    // 水平角以 Three 相机默认朝向（-Z）为 0°，向右为正，和常见取景器/云台读数一致。
    yaw: Math.atan2(dx, -dz) * 180 / Math.PI,
    pitch: Math.asin(Math.max(-1, Math.min(1, dy / distance))) * 180 / Math.PI,
    roll: anchor.camera.roll ?? 0,
    distance,
  };
});
// 焦段与 FOV 是同一件事的两种表达：面板显示毫米数，内部仍存 FOV，导出/运镜链路不用改。
const anchorFocal = computed(() => {
  const fov = activeAnchor.value?.camera.fov ?? 45;
  return Math.round((runtime?.camera.filmGauge ?? 35) / 2 / Math.tan(fov * Math.PI / 360));
});
function aimAnchor(yawDegree: number, pitchDegree: number, distance = cameraAngles.value.distance) {
  const anchor = activeAnchor.value;
  if (!anchor) return;
  const yaw = yawDegree * Math.PI / 180;
  // 俯仰不超过 88°，避免注视点与机位重合导致 up 向量退化。
  const pitch = Math.max(-88, Math.min(88, pitchDegree)) * Math.PI / 180;
  const { position } = anchor.camera;
  const direction = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  anchor.controls = { target: {
    x: round(position.x + direction.x * distance),
    y: round(position.y + direction.y * distance),
    z: round(position.z + direction.z * distance),
  } };
}
function setAnchorAngles(next: { yaw?: number; pitch?: number; roll?: number }, commit = false) {
  const anchor = activeAnchor.value;
  if (!anchor) return;
  if (next.yaw !== undefined || next.pitch !== undefined) aimAnchor(next.yaw ?? cameraAngles.value.yaw, next.pitch ?? cameraAngles.value.pitch);
  if (next.roll !== undefined) anchor.camera = { ...anchor.camera, roll: Math.round(next.roll * 10) / 10 };
  if (viewMode.value === "camera" && runtime) applyCamera(runtime.camera, anchor);
  if (commit) {
    anchors.value = [...anchors.value];
    scheduleThumbnails();
  }
  runtime?.invalidate();
}
function commitAnchorAngles() {
  anchors.value = [...anchors.value];
  scheduleThumbnails();
  runtime?.invalidate();
}
function setAnchorFocal(millimeters: number) {
  const anchor = activeAnchor.value;
  if (!anchor) return;
  const gauge = runtime?.camera.filmGauge ?? 35;
  const fov = 2 * Math.atan(gauge / 2 / Math.max(6, millimeters)) * 180 / Math.PI;
  anchor.camera = { ...anchor.camera, fov: Math.round(Math.min(120, Math.max(10, fov)) * 10) / 10 };
  if (runtime && viewMode.value === "camera") {
    runtime.camera.fov = anchor.camera.fov;
    runtime.camera.updateProjectionMatrix();
    focalLength.value = runtime.camera.getFocalLength();
  }
  anchors.value = [...anchors.value];
  scheduleThumbnails();
  runtime?.invalidate();
}
// ACT: 俯拍 / 仰拍按「绕被摄体升降机位」实现（原地低头只会拍到地面），和成熟取景工具的高低位机位一致。
function subjectCenter() {
  const anchor = activeAnchor.value;
  const fallback = new Vector3(anchor?.controls.target.x ?? 0, anchor?.controls.target.y ?? 1, anchor?.controls.target.z ?? 0);
  if (!anchor || !runtime) return fallback;
  const subjectId = lookTarget.value || props.scene.objectList.find(object => object.objType === "mannequin")?.threeJsonId || props.scene.objectList[0]?.threeJsonId;
  const object = subjectId ? getObjectByThreeJsonId(subjectId, runtime.scene) : undefined;
  return object ? new Box3().setFromObject(object).getCenter(new Vector3()) : fallback;
}
function setShotAngle(kind: "level" | "high" | "low" | "dutch" | "reset") {
  const anchor = activeAnchor.value;
  if (!anchor || !runtime) return;
  if (kind === "dutch") return setAnchorAngles({ roll: Math.abs(cameraAngles.value.roll) < 0.5 ? 12 : 0 }, true);
  const center = subjectCenter();
  const roll = kind === "reset" ? 0 : anchor.camera.roll ?? 0;
  if (kind === "reset") {
    anchor.camera = { ...anchor.camera, roll: 0 };
    anchor.controls = { target: { x: round(center.x), y: round(center.y), z: round(center.z) } };
  } else {
    const { position } = anchor.camera;
    const offset = new Vector3(position.x - center.x, position.y - center.y, position.z - center.z);
    const radius = Math.max(0.8, offset.length());
    const azimuth = Math.atan2(offset.x, -offset.z);
    const requested = kind === "level" ? 0 : kind === "high" ? 25 * Math.PI / 180 : -25 * Math.PI / 180;
    // 低角度时不允许机位钻到地面以下。
    const floorLimit = Math.asin(Math.max(-0.95, Math.min(0.95, (0.25 - center.y) / radius)));
    const elevation = Math.max(floorLimit, requested);
    anchor.camera = { ...anchor.camera, roll, position: {
      x: round(center.x + Math.sin(azimuth) * Math.cos(elevation) * radius),
      y: round(center.y + Math.sin(elevation) * radius),
      z: round(center.z - Math.cos(azimuth) * Math.cos(elevation) * radius),
    } };
    anchor.controls = { target: { x: round(center.x), y: round(center.y), z: round(center.z) } };
  }
  anchors.value = [...anchors.value];
  if (viewMode.value === "camera") applyCamera(runtime.camera, anchor);
  scheduleThumbnails();
  runtime.invalidate();
}

// ACT: 景别预设保持当前机位方向，只沿视线推拉，避免调完景别又把构图方向也改掉。
function frameSubject(kind: "full" | "half" | "close") {
  const anchor = activeAnchor.value;
  if (!anchor || !runtime) return;
  const subjectId = lookTarget.value || props.scene.objectList.find(object => object.objType === "mannequin")?.threeJsonId || props.scene.objectList[0]?.threeJsonId;
  const object = subjectId ? getObjectByThreeJsonId(subjectId, runtime.scene) : undefined;
  const center = object
    ? new Box3().setFromObject(object).getCenter(new Vector3())
    : new Vector3(anchor.controls.target.x, anchor.controls.target.y, anchor.controls.target.z);
  const height = { full: 2.2, half: 1.2, close: 0.62 }[kind];
  center.y += { full: 0, half: 0.32, close: 0.58 }[kind];
  const distance = Math.min(60, Math.max(0.55, height / 2 / Math.tan(anchor.camera.fov * Math.PI / 360)));
  const { position } = anchor.camera;
  const direction = new Vector3(position.x - center.x, position.y - center.y, position.z - center.z);
  if (direction.lengthSq() < 1e-4) direction.set(0, 0, 1);
  direction.normalize();
  anchor.camera = { ...anchor.camera, position: { x: round(center.x + direction.x * distance), y: round(center.y + direction.y * distance), z: round(center.z + direction.z * distance) } };
  anchor.controls = { target: { x: round(center.x), y: round(center.y), z: round(center.z) } };
  anchors.value = [...anchors.value];
  if (viewMode.value === "camera") applyCamera(runtime.camera, anchor);
  scheduleThumbnails();
  runtime.invalidate();
}

function setAnchorFromDirectorView() {
  const anchor = activeAnchor.value;
  if (!anchor || !runtime) return;
  const view = viewMode.value === "director" ? captureCamera(runtime) : directorCameraState;
  if (!view) return void ElMessage.warning("请先切到导演视角调整构图，再设为此机位");
  anchor.camera = view.camera;
  anchor.controls = view.controls;
  anchors.value = [...anchors.value];
  if (viewMode.value === "camera") applyCamera(runtime.camera, anchor);
  scheduleThumbnails();
  runtime.invalidate();
  ElMessage.success("已用导演视角更新机位");
}
function markShootingAnchor() {
  const anchor = activeAnchor.value;
  if (!anchor) return;
  shootingAnchorId.value = shootingAnchorId.value === anchor.id ? "" : anchor.id;
  ElMessage.success(shootingAnchorId.value ? `已将「${anchor.name || "机位"}」设为拍摄机位` : "已取消拍摄机位");
}
function duplicateAnchor() {
  const anchor = activeAnchor.value;
  if (!anchor) return;
  if (anchors.value.length >= 100) return void ElMessage.warning("最多记录 100 个机位");
  const copy = anchorSchema.parse({ ...structuredClone(anchor), id: crypto.randomUUID(), name: `${anchor.name || "机位"} 副本` });
  anchors.value = [...anchors.value, copy];
  captureFlash.value++;
  syncGizmos();
  ElMessage.success("已复制机位");
}
// ACT: 记录镜头关键帧 —— 机位预览下取当前镜头，导演视角下取选中机位（没有机位时取当前视角）。
function recordCameraKeyframe() {
  if (!runtime) return;
  const view = viewMode.value === "camera"
    ? captureCamera(runtime)
    : activeAnchor.value
      ? { camera: { ...activeAnchor.value.camera }, controls: { target: { ...activeAnchor.value.controls.target } } }
      : captureCamera(runtime);
  emit("addCameraKeyframe", view, currentTime.value);
}
function removeCameraKeyframeAtCurrent() {
  emit("removeCameraKeyframe", currentTime.value);
}
function removeObjectKeyframeAtCurrent() {
  const object = selectedObject.value;
  if (!object) return;
  emit("removeObjectKeyframe", object.threeJsonId, currentTime.value);
}
function applyLookTarget() {
  const anchor = activeAnchor.value;
  if (!anchor || !runtime || !lookTarget.value) return;
  const object = getObjectByThreeJsonId(lookTarget.value, runtime.scene);
  if (!object) return void ElMessage.warning("找不到注视目标，可能已被删除");
  const center = new Box3().setFromObject(object).getCenter(new Vector3());
  anchor.controls = { target: { x: center.x, y: center.y, z: center.z } };
  if (viewMode.value === "camera") applyCamera(runtime.camera, anchor);
  scheduleThumbnails();
  runtime.invalidate();
}
function jumpToAnchor(anchor: CameraAnchor) {
  activeAnchorId.value = anchor.id;
  selectedObjectId.value = "";
  panelTab.value = "anchor";
  toggleOrbitOff();
  pausePlayback();
  setViewMode("camera");
  if (anchor.time !== undefined && props.result) {
    currentTime.value = Math.min(props.result.duration, anchor.time);
    scenePlayer?.setTime(currentTime.value);
  }
  sampleTime();
  focalLength.value = runtime?.camera.getFocalLength() ?? focalLength.value;
  syncSelectionHelper();
  syncTransformAttachment();
  runtime?.invalidate();
}
function removeAnchor(id: string) {
  delete anchorPreviews.value[id];
  anchors.value = anchors.value.filter(anchor => anchor.id !== id);
  if (activeAnchorId.value === id) {
    activeAnchorId.value = "";
    if (viewMode.value === "camera") setViewMode("director");
  }
}
function markerPercent(anchor: CameraAnchor) {
  const duration = props.result?.duration || 1;
  return Math.min(100, Math.max(0, (anchor.time ?? 0) / duration * 100));
}
function seekFromTrack(event: MouseEvent) {
  if (!props.result) return;
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  seekTime(ratio * props.result.duration);
}
function pausePlayback() {
  playing.value = false;
}
function togglePlayback() {
  if (!ready.value || !props.result) return;
  if (playing.value) return pausePlayback();
  if (currentTime.value >= props.result.duration) currentTime.value = 0;
  if (viewMode.value !== "camera") setViewMode("camera");
  sampleTime();
  previousFrame = performance.now();
  playing.value = true;
}
function seekTime(value: number | number[]) {
  pausePlayback();
  currentTime.value = Math.max(0, Math.min(props.result?.duration ?? 0, Array.isArray(value) ? value[0]! : value));
  sampleTime();
}
function formatTime(value: number) {
  return value.toFixed(2);
}

function closeEditor() {
  pausePlayback();
  toggleOrbitOff();
  rememberDirectorView();
  visible.value = false;
}
function releaseStage() {
  controls?.dispose();
  controls = undefined;
  if (transformControls) {
    transformControls.detach();
    transformControls.dispose();
    transformControls = undefined;
  }
  if (transformHelper && runtime) runtime.scene.remove(transformHelper);
  transformHelper = undefined;
  disposeYawRing();
  gizmoDragging = false;
  scenePlayer?.dispose();
  scenePlayer = undefined;
  cameraFrames = undefined;
  for (const [, group] of gizmos) disposeGizmo(group);
  gizmos.clear();
  if (selectionHelper) {
    selectionHelper.geometry.dispose();
    (selectionHelper.material as LineBasicMaterial).dispose();
    selectionHelper = undefined;
  }
  if (runtime) disposeStage(runtime);
  runtime = undefined;
}
// ACT: 文档变化后的舞台同步——能用原位刷新就不重建，否则整场景重载。
function syncStage() {
  if (!ready.value) return;
  try {
    if (props.scene !== loadedScene) {
      if (runtime && loadedScene && canSyncInPlace(loadedScene, props.scene)) {
        // 纯位移 / 旋转 / 缩放 / 颜色 / 姿势变化：原位刷新，不打断当前视角与播放。
        syncSceneInPlace(runtime, props.scene);
        loadedScene = props.scene;
        scenePlayer?.setTime(currentTime.value);
        syncSelectionHelper();
      } else {
        const previous = loadedScene;
        const cameraChanged = !!previous && (JSON.stringify(previous.sceneConfig.camera) !== JSON.stringify(props.scene.sceneConfig.camera)
          || JSON.stringify(previous.sceneConfig.controls) !== JSON.stringify(props.scene.sceneConfig.controls));
        return void loadScene({ resetView: cameraChanged });
      }
    }
    const planKey = props.result ? JSON.stringify(props.result) : "";
    if (planKey !== loadedPlanKey) setAnimation(props.result?.id === loadedPlanId && !!props.result);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "场景更新失败");
  }
}
watch([currentTime, playing, sceneAspect, focalLength, activeAnchorId], () => runtime?.invalidate());
watch([() => props.scene, () => props.result], syncStage, { flush: "post" });
onMounted(() => {
  anchors.value = anchors.value.map(anchor => anchorSchema.parse(anchor));
  document.addEventListener("keydown", onShortcut);
  document.addEventListener("pointermove", onRingPointerMove);
  document.addEventListener("pointerup", onRingPointerUp);
  emit("loadModels");
});
onBeforeUnmount(() => {
  disposed = true;
  ++loadVersion;
  clearTimeout(thumbnailTimer);
  document.removeEventListener("keydown", onShortcut);
  document.removeEventListener("pointermove", onRingPointerMove);
  document.removeEventListener("pointerup", onRingPointerUp);
  pausePlayback();
  releaseStage();
});
</script>

<style lang="scss" scoped>
.directorDialog {
  :deep(.el-dialog__header) { padding: 8px 52px 8px 16px; margin-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); }
  :deep(.el-dialog__headerbtn) { top: 0; width: 48px; height: 49px; }
  :deep(.el-dialog__body) { padding: 10px 12px 12px; }
}
.directorHeader {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--el-text-color-primary);
  small { font-size: 12px; font-weight: 400; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .headerSpacer { flex: 1; }
  .headerSub { color: var(--el-text-color-placeholder) !important; font-size: 11px !important; }
  .headerStat { font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; margin-right: 4px; }
  .el-button { margin: 0; }
  .activeButton { color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 12%, transparent); }
}
.directorWorkspace {
  display: grid;
  grid-template-columns: 44px 232px minmax(0, 1fr) 328px;
  gap: 10px;
  height: calc(100dvh - 94px);
  min-height: 0;
  &.withAi { grid-template-columns: 44px 232px minmax(0, 1fr) 328px 336px; }
  .toolRail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 0;
    border-radius: 10px;
    background: var(--el-fill-color-light);
    .railButton {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--el-text-color-regular);
      cursor: pointer;
      &:hover { background: var(--el-fill-color); }
      &.active { background: color-mix(in srgb, var(--el-color-primary) 18%, transparent); color: var(--el-color-primary); }
      &:disabled { opacity: 0.45; cursor: not-allowed; }
    }
    .railDivider { width: 22px; height: 1px; margin: 4px 0; background: var(--el-border-color); }
  }
  .libraryPanel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 10px;
    overflow-y: auto;
    border-radius: 10px;
    background: var(--el-fill-color-light);
    .panelBlock {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
      &.sceneBlock { min-height: 190px; }
    }
    .libraryClose { display: none; }
    .refCard {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--el-border-color);
      border-radius: 8px;
      background: var(--el-bg-color);
      img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; }
      .refTag {
        position: absolute;
        left: 6px;
        bottom: 6px;
        padding: 1px 6px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
        font-size: 10px;
      }
    }
    .refEmpty {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px;
      color: var(--el-text-color-placeholder);
      font-size: 11px;
      line-height: 1.45;
    }
    .refRow {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: var(--el-text-color-secondary);
      font-size: 11px;
      .modelSelect { width: 100%; }
    }
    .wideButton { width: 100%; margin: 0; }
    .panelHint { margin: 0; color: var(--el-text-color-placeholder); font-size: 10px; line-height: 1.5; }
    .addRow {
      display: flex;
      gap: 6px;
      .presetSelect { flex: 1; min-width: 0; }
      .el-button { margin: 0; }
    }
    .presetList { display: flex; flex-direction: column; gap: 2px; }
    .presetItem {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 6px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--el-text-color-regular);
      font-size: 12px;
      text-align: left;
      cursor: pointer;
      &:hover { background: var(--el-fill-color); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
      span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      small { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
    }
    .crowdBlock {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      border-radius: 8px;
      background: var(--el-bg-color);
      .crowdRow { display: flex; gap: 6px; align-items: center; }
      .crowdX { color: var(--el-text-color-secondary); }
    }
    .propGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 2px 0 4px; }
    .propItem {
      padding: 5px 4px;
      border: 1px solid var(--el-border-color);
      border-radius: 6px;
      background: var(--el-bg-color);
      color: var(--el-text-color-regular);
      font-size: 11px;
      cursor: pointer;
      &:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .panelFooter { margin: 0; color: var(--el-text-color-placeholder); font-size: 10px; line-height: 1.5; }
    .panelTitle {
      display: flex;
      justify-content: space-between;
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--el-text-color-primary);
      small { font-weight: 400; color: var(--el-text-color-secondary); }
    }
    .libraryTree {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 2px;
      min-height: 0;
    }
    .treeGroup {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--el-text-color-regular);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      &:hover { background: var(--el-fill-color); }
      small { margin-left: auto; color: var(--el-text-color-secondary); font-weight: 400; }
      .treeArrow { transition: transform 0.15s; &.open { transform: rotate(90deg); } }
    }
    .treeItem {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px 6px 22px;
      border-radius: 6px;
      color: var(--el-text-color-regular);
      font-size: 12px;
      cursor: pointer;
      &:hover { background: var(--el-fill-color); }
      &.selected { background: color-mix(in srgb, var(--el-color-primary) 16%, transparent); color: var(--el-color-primary); }
      .treeName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .treeDot { width: 6px; height: 6px; border-radius: 50%; background: var(--el-color-primary); }
    }
    .libraryEmpty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 18px 8px;
      color: var(--el-text-color-placeholder);
      font-size: 12px;
      text-align: center;
      line-height: 1.6;
    }
  }
  .stagePanel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    position: relative;
    .stageToolbar {
      display: flex;
      flex-shrink: 0;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 2px 8px;
      .viewToggle {
        display: flex;
        gap: 2px;
        padding: 3px;
        border-radius: 8px;
        background: var(--el-fill-color-light);
        button {
          padding: 4px 12px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--el-text-color-regular);
          font-size: 12px;
          cursor: pointer;
          &.active { background: var(--el-color-primary); color: #fff; }
        }
      }
      .cameraSelect { width: 118px; }
      .aspectSelect { width: 84px; }
      .transformModes {
        display: flex;
        gap: 2px;
        padding: 3px;
        border-radius: 8px;
        background: var(--el-fill-color-light);
        button {
          padding: 3px 10px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--el-text-color-regular);
          font-size: 12px;
          cursor: pointer;
          &.active { background: var(--el-color-primary); color: #fff; }
          &:disabled { opacity: 0.45; cursor: not-allowed; }
        }
      }
      .toolbarSpacer { flex: 1; }
      .toolPill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border: 0;
        border-radius: 999px;
        background: var(--el-fill-color-light);
        color: var(--el-text-color-regular);
        font-size: 12px;
        cursor: pointer;
        &:hover { background: var(--el-fill-color); }
        &.active { background: var(--el-color-primary); color: #fff; }
      }
    }
    .viewport {
      position: relative;
      display: grid;
      place-items: center;
      container-type: size;
      flex: 1;
      min-height: 180px;
      overflow: hidden;
      border-radius: 10px;
      background: #242a31;
      .sceneCanvas,
      .captureFlash {
        width: min(100cqw, calc(100cqh * var(--sceneAspect)));
        height: min(100cqh, calc(100cqw / var(--sceneAspect)));
      }
      .sceneCanvas {
        display: block;
        object-fit: contain;
        touch-action: none;
        outline: 3px solid transparent;
        outline-offset: -3px;
        transition: outline-color 0.2s, box-shadow 0.2s;
        &.playing, &.cameraView {
          outline-color: var(--el-color-primary);
          box-shadow: 0 0 18px color-mix(in srgb, var(--el-color-primary) 35%, transparent);
        }
        &.cameraView { cursor: grab; }
        &.cameraView:active { cursor: grabbing; }
      }
      .captureFlash {
        position: absolute;
        inset: 0;
        margin: auto;
        background: #fff;
        opacity: 0;
        pointer-events: none;
        animation: directorCapture 280ms ease-out;
      }
      .frameGuides {
        position: absolute;
        inset: 0;
        margin: auto;
        width: min(100cqw, calc(100cqh * var(--sceneAspect)));
        height: min(100cqh, calc(100cqw / var(--sceneAspect)));
        z-index: 2;
        pointer-events: none;
        .guideLine {
          position: absolute;
          background: rgba(255, 255, 255, 0.22);
          &.vertical { top: 0; bottom: 0; width: 1px; }
          &.horizontal { left: 0; right: 0; height: 1px; }
        }
        .guideSafe {
          position: absolute;
          inset: 5%;
          border: 1px dashed rgba(255, 255, 255, 0.4);
          border-radius: 2px;
        }
        .guideLabel {
          position: absolute;
          right: 8px;
          bottom: 6px;
          padding: 1px 6px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.5);
          color: rgba(255, 255, 255, 0.8);
          font-size: 10px;
        }
      }
      .toolPill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border: 0;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
        color: rgba(255, 255, 255, 0.82);
        font-size: 12px;
        cursor: pointer;
        &:hover { background: rgba(0, 0, 0, 0.75); color: #fff; }
        &.active { background: var(--el-color-primary); color: #fff; }
        &:disabled { opacity: 0.45; cursor: not-allowed; }
      }
      .axisTools {
        position: absolute;
        top: 10px;
        right: 12px;
        z-index: 3;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        .axisGizmo {
          overflow: visible;
          .axisRing { fill: rgba(0, 0, 0, 0.45); stroke: rgba(255, 255, 255, 0.15); }
          g { line, circle { stroke-width: 2; } line { stroke: currentColor; } text { fill: currentColor; font-size: 11px; font-weight: 700; text-anchor: middle; } }
          g.axis-x { color: #ff5f5f; } g.axis-y { color: #6ee37a; } g.axis-z { color: #5b9bff; }
          g.axis-nx, g.axis-ny, g.axis-nz { color: #d0d4dc; }
        }
      }
      .viewportInfo {
        position: absolute;
        top: 12px;
        left: 14px;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 2px;
        color: #fff;
        font-size: 11px;
        text-shadow: 0 1px 4px #000;
        pointer-events: none;
        font-variant-numeric: tabular-nums;
        .ringHint { color: #fcd34d; }
      }
      .cameraHud {
        position: absolute;
        right: 12px;
        bottom: 12px;
        z-index: 3;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        padding: 6px 9px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.55);
        color: rgba(255, 255, 255, 0.78);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
        .hudLens { color: #fcd34d; font-size: 12px; font-weight: 600; }
        .hudRoll { color: #7dd3fc; }
      }
      .cameraReticle {
        position: absolute;
        inset: 0;
        margin: auto;
        width: 44px;
        height: 44px;
        z-index: 3;
        pointer-events: none;
        opacity: 0.75;
        i { position: absolute; left: 50%; width: 1px; height: 11px; background: rgba(255, 255, 255, 0.65); }
        i:nth-child(1) { top: 0; }
        i:nth-child(2) { bottom: 0; }
        span {
          position: absolute;
          inset: 0;
          margin: auto;
          width: 9px;
          height: 9px;
          border: 1px solid rgba(255, 255, 255, 0.8);
          border-radius: 50%;
        }
      }
      .cameraPip {
        position: absolute;
        top: 54px;
        left: 14px;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 3px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
        font-size: 10px;
        cursor: zoom-in;
        img { display: block; width: 96px; border-radius: 5px; }
        span { padding: 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      }
      .viewShortcuts {
        position: absolute;
        left: 14px;
        bottom: 12px;
        z-index: 3;
        display: flex;
        gap: 6px;
      }
      .ringTip {
        position: absolute;
        left: 14px;
        bottom: 46px;
        z-index: 3;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 9px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.55);
        color: #fcd34d;
        font-size: 11px;
        pointer-events: none;
        span { color: rgba(255, 255, 255, 0.6); }
      }
      .cameraPrompt {
        position: absolute;
        left: 50%;
        bottom: 12px;
        transform: translateX(-50%);
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 6px;
        width: min(360px, 50%);
        padding: 4px 4px 4px 10px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(6px);
        color: rgba(255, 255, 255, 0.7);
        input {
          flex: 1;
          min-width: 0;
          border: 0;
          outline: none;
          background: transparent;
          color: #fff;
          font-size: 12px;
          &::placeholder { color: rgba(255, 255, 255, 0.5); }
        }
        button {
          display: grid;
          place-items: center;
          width: 26px;
          height: 26px;
          border: 0;
          border-radius: 50%;
          background: var(--el-color-primary);
          color: #fff;
          cursor: pointer;
          &:disabled { opacity: 0.4; cursor: not-allowed; }
        }
      }
      .stageLoading {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: var(--el-bg-color-overlay);
        color: var(--el-text-color-secondary);
        font-size: 12px;
        z-index: 5;
        .loadingIcon { animation: directorLoading 1s linear infinite; }
        &.failed { color: var(--el-color-danger); }
        .stageError { max-width: 520px; text-align: center; line-height: 1.7; overflow-wrap: anywhere; }
      }
    }
    .timelineMeta {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 2px 6px;
      color: var(--el-text-color-secondary);
      font-size: 11px;
      .metaTitle { color: var(--el-text-color-primary); font-weight: 600; }
      .metaItem { font-variant-numeric: tabular-nums; }
      .metaSpacer { flex: 1; }
      .metaAction {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 9px;
        border: 1px solid var(--el-border-color);
        border-radius: 999px;
        background: var(--el-bg-color);
        color: var(--el-text-color-regular);
        font-size: 11px;
        cursor: pointer;
        &:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
        &:disabled { opacity: 0.45; cursor: not-allowed; }
      }
    }
    .timelineBar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 2px 2px;
      flex-shrink: 0;
      .iconButton { width: 30px; height: 30px; padding: 0; margin: 0; }
      .timeLabel {
        color: var(--el-text-color-secondary);
        font-size: 11px;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .timelineTrack {
        position: relative;
        flex: 1;
        min-width: 0;
        height: 32px;
        border-radius: 6px;
        background: var(--el-fill-color-light);
        cursor: pointer;
        .timelineRuler {
          position: absolute;
          inset: 14px 0;
          border-top: 1px solid var(--el-border-color);
        }
        .timelineTick {
          position: absolute;
          top: 2px;
          transform: translateX(-50%);
          color: var(--el-text-color-placeholder);
          font-size: 9px;
          line-height: 1;
          pointer-events: none;
          font-variant-numeric: tabular-nums;
        }
        .timelineCursor {
          position: absolute;
          top: 4px;
          bottom: 4px;
          width: 2px;
          background: var(--el-color-primary);
          pointer-events: none;
        }
        .timelineKey {
          position: absolute;
          top: 15px;
          width: 4px;
          height: 8px;
          margin-left: -2px;
          border-radius: 1px;
          background: #a78bfa;
          opacity: 0.75;
          pointer-events: none;
        }
        .timelineCamera {
          position: absolute;
          top: 15px;
          width: 6px;
          height: 8px;
          margin-left: -3px;
          border-radius: 1px;
          background: #2dd4bf;
          pointer-events: none;
        }
        .timelineMarker {
          position: absolute;
          top: 50%;
          width: 12px;
          height: 12px;
          margin: -6px 0 0 -6px;
          border-radius: 3px;
          transform: rotate(45deg);
          background: #f59e0b;
          border: 1px solid rgba(0, 0, 0, 0.35);
          cursor: pointer;
          &.selected { background: var(--el-color-primary); outline: 2px solid color-mix(in srgb, var(--el-color-primary) 40%, transparent); }
        }
      }
      > .el-button { margin: 0; }
    }
  }
  .settingsPanel {
    display: flex;
    flex-direction: column;
    padding: 6px 10px 10px;
    border-radius: 10px;
    background: var(--el-fill-color-light);
    overflow-y: auto;
    min-height: 0;
    .panelTabs {
      display: flex;
      flex-direction: column;
      min-height: 0;
      :deep(.el-tabs__header) { margin: 0 0 8px; }
      :deep(.el-tabs__content) { display: flex; flex-direction: column; }
      :deep(.el-tabs__item) { font-size: 13px; font-weight: 600; padding: 0 14px; height: 34px; }
    }
    .subTabs {
      :deep(.el-tabs__header) { margin: 0 0 10px; }
      :deep(.el-tabs__nav-wrap::after) { height: 1px; }
      :deep(.el-tabs__item) { font-size: 12px; font-weight: 500; height: 30px; }
    }
    .panelEmpty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 26px 10px;
      color: var(--el-text-color-placeholder);
      font-size: 12px;
      text-align: center;
      line-height: 1.6;
      p { margin: 0; }
      .emptyActions { display: flex; gap: 8px; .el-button { margin: 0; } }
    }
    .sectionLabel {
      display: flex;
      justify-content: space-between;
      margin: 2px 0 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--el-text-color-primary);
      small { font-weight: 400; color: var(--el-text-color-secondary); }
    }
    .panelSection {
      padding-bottom: 12px;
      margin-bottom: 4px;
      border-bottom: 1px solid var(--el-border-color-lighter);
      &:last-child { border-bottom: 0; }
      h3 {
        margin: 0 0 10px;
        font-size: 13px;
        font-weight: 600;
        color: var(--el-text-color-primary);
        small { color: var(--el-text-color-secondary); font-weight: 400; margin-left: 4px; }
        .shootBadge {
          margin-left: 6px;
          padding: 1px 6px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--el-color-primary) 16%, transparent);
          color: var(--el-color-primary);
          font-size: 10px;
          font-weight: 500;
        }
      }
    }
    .fieldRow {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      > span {
        flex: 0 0 72px;
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }
      > .el-slider { flex: 1; min-width: 0; --el-slider-height: 4px; --el-slider-button-size: 12px; margin: 0; }
      > .el-select, > .el-input { flex: 1; min-width: 0; }
      > .el-input-number { width: 100px; }
      > .el-button { margin: 0; }
      .axisField {
        display: flex;
        align-items: center;
        gap: 3px;
        flex: 1;
        min-width: 0;
        small { color: var(--el-text-color-secondary); font-size: 11px; }
        .el-input-number { width: 100%; }
        :deep(.el-input__inner) { text-align: left; padding-left: 6px; }
      }
      .sliderValue { flex: 0 0 44px; text-align: right; font-size: 12px; color: var(--el-text-color-regular); font-variant-numeric: tabular-nums; }
      &.angleRow > span:first-child { flex: 0 0 40px; }
      &.angleRow > .sliderValue { flex: 0 0 40px; }
      .colorValue, .fileName { font-size: 12px; color: var(--el-text-color-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fileName { flex: 1; }
    }
    .backdropThumb {
      margin: -2px 0 10px;
      aspect-ratio: 16 / 6;
      border-radius: 8px;
      overflow: hidden;
      background: #141418;
      display: grid;
      place-items: center;
      color: var(--el-text-color-secondary);
      img { width: 100%; height: 100%; object-fit: cover; }
      .loadingIcon { animation: directorLoading 1s linear infinite; }
    }
    .presetRow {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
      .presetChip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 9px 3px 6px;
        border: 1px solid var(--el-border-color);
        border-radius: 999px;
        background: var(--el-bg-color);
        color: var(--el-text-color-regular);
        font-size: 12px;
        cursor: pointer;
        &::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--swatch, var(--el-color-primary)); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15) inset; }
        &:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
      }
    }
    .angleChips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: -2px 0 10px;
      button {
        padding: 2px 8px;
        border: 1px solid var(--el-border-color);
        border-radius: 999px;
        background: var(--el-bg-color);
        color: var(--el-text-color-regular);
        font-size: 11px;
        cursor: pointer;
        &:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
      }
    }
    .framingRow {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
      > span { flex: 0 0 72px; color: var(--el-text-color-secondary); font-size: 12px; }
      button {
        flex: 1;
        padding: 3px 0;
        border: 1px solid var(--el-border-color);
        border-radius: 6px;
        background: var(--el-bg-color);
        color: var(--el-text-color-regular);
        font-size: 11px;
        cursor: pointer;
        &:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
      }
    }
    .lightGrid {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 10px;
      .lightRow {
        display: grid;
        grid-template-columns: 22px repeat(8, 1fr);
        align-items: center;
        gap: 4px;
        .lightHeight { font-size: 11px; color: var(--el-text-color-secondary); }
        .lightDot {
          height: 16px;
          border: 0;
          border-radius: 4px;
          background: color-mix(in srgb, var(--el-color-warning) 18%, var(--el-bg-color));
          cursor: pointer;
          &:nth-child(even) { background: color-mix(in srgb, var(--el-color-warning) 30%, var(--el-bg-color)); }
          &:hover { background: color-mix(in srgb, var(--el-color-warning) 55%, var(--el-bg-color)); }
          &.active { background: var(--el-color-warning); box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-warning) 35%, transparent); }
        }
      }
    }
    .jointSelect { width: 100%; margin-bottom: 8px; }
    .fieldHint { margin: 4px 0 10px; color: var(--el-text-color-placeholder); font-size: 11px; line-height: 1.6; }
    .buttonRow {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      .el-button { margin: 0; flex: 1; }
    }
    .poseGrid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin-bottom: 12px;
      .poseCard {
        padding: 8px 6px;
        border: 1px solid var(--el-border-color);
        border-radius: 8px;
        background: var(--el-bg-color);
        color: var(--el-text-color-regular);
        font-size: 12px;
        cursor: pointer;
        &:hover { border-color: var(--el-color-primary); }
        &.active { border-color: var(--el-color-primary); color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 10%, transparent); }
      }
    }
    .trackList {
      display: flex;
      flex-direction: column;
      gap: 6px;
      .trackItem {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: var(--el-border-radius-small);
        .trackName { flex: 1; min-width: 0; font-size: 12px; color: var(--el-text-color-regular); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        small { color: var(--el-text-color-secondary); font-size: 11px; white-space: nowrap; }
        .el-button { margin: 0; padding: 4px 6px; }
      }
    }
    .anchorGrid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 10px;
      .anchorCard {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 3px;
        border: 1px solid var(--el-border-color);
        border-radius: 8px;
        background: var(--el-bg-color);
        color: var(--el-text-color-regular);
        font-size: 11px;
        cursor: pointer;
        text-align: left;
        img, .anchorThumbEmpty { display: grid; place-items: center; width: 100%; aspect-ratio: 16 / 9; border-radius: 5px; background: #1a1a20; object-fit: cover; color: var(--el-text-color-placeholder); }
        span { padding: 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        small { padding: 0 2px; color: var(--el-text-color-secondary); }
        &:hover { border-color: var(--el-color-primary); }
        &.active { border-color: var(--el-color-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-primary) 25%, transparent); }
        &.addCard { align-items: center; justify-content: center; border-style: dashed; color: var(--el-text-color-secondary); &:disabled { opacity: 0.5; cursor: not-allowed; } }
      }
    }
    :deep(.directionControl) {
      margin-bottom: 10px;
      .directionViewport { height: 172px; }
    }
  }
  .aiDrawer {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    padding: 6px 8px 8px;
    border-radius: 10px;
    background: var(--el-fill-color-light);
    .aiDrawerTabs {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      :deep(.el-tabs__header) { margin: 0 0 6px; }
      :deep(.el-tabs__content) { flex: 1; min-height: 0; }
      :deep(.el-tab-pane) { height: 100%; }
    }
    .chatTab {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      :deep(.agentChat) { flex: 1; min-height: 0; }
      .chatQuickActions {
        display: flex;
        flex-shrink: 0;
        gap: 6px;
        padding-top: 6px;
        .el-button { flex: 1; margin: 0; }
      }
    }
    :deep(.directorPanel) { height: 100%; }
  }
  .aiDrawer-enter-active, .aiDrawer-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
  .aiDrawer-enter-from, .aiDrawer-leave-to { opacity: 0; transform: translateX(12px); }
}
.railPanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  .panelTitle { font-weight: 600; font-size: 13px; color: var(--el-text-color-primary); }
  .crowdRow { display: flex; align-items: center; gap: 6px; .el-input-number { width: 72px; } .crowdX { color: var(--el-text-color-secondary); } }
}
.primitiveGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  .el-button { margin: 0; width: 100%; }
}
.trackGroups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  overflow-y: auto;
  section {
    display: flex;
    flex-direction: column;
    gap: 2px;
    h4 {
      display: flex;
      justify-content: space-between;
      margin: 0 0 2px;
      color: var(--el-text-color-primary);
      font-size: 12px;
      font-weight: 600;
      small { color: var(--el-text-color-secondary); font-weight: 400; }
    }
    button {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 6px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--el-text-color-regular);
      font-size: 11px;
      text-align: left;
      cursor: pointer;
      &:hover { background: var(--el-fill-color-light); color: var(--el-color-primary); }
      small { flex-shrink: 0; color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
    }
    p { margin: 2px 6px; color: var(--el-text-color-placeholder); font-size: 11px; }
  }
}
@keyframes directorCapture {
  from { opacity: 0.55; }
  to { opacity: 0; }
}
@keyframes directorLoading {
  to { transform: rotate(360deg); }
}
/* 宽屏素材库常驻，窄屏用侧栏按钮以浮层展开。 */
.directorWorkspace .railButton.libraryToggle { display: none; }

@media (max-width: 1500px) {
  .directorWorkspace .stagePanel .timelineBar {
    flex-wrap: wrap;
    row-gap: 6px;
    .timeLabel { order: 2; }
    .exportButton { order: 3; }
    .exportStart { margin-left: auto; }
    .timelineTrack { order: 5; flex: 1 1 100%; }
  }
  .directorWorkspace .stagePanel .viewport .cameraPrompt { width: min(300px, 56%); }
}
@media (max-width: 1360px) {
  .directorWorkspace .stagePanel .viewport .cameraPrompt { display: none; }
  // 窄面板里三个坐标输入挤在一行会截断数值，改为标签独占一行、输入均分下一行。
  .directorWorkspace .settingsPanel .fieldRow.vectorRow {
    flex-wrap: wrap;
    row-gap: 4px;
    > span { flex: 0 0 100%; }
  }
}
@media (max-width: 1280px) {
  .directorWorkspace {
    position: relative;
    grid-template-columns: 44px minmax(0, 1fr) 300px;
    &.withAi { grid-template-columns: 44px minmax(0, 1fr) 300px 320px; }
    .railButton.libraryToggle { display: grid; }
    .libraryPanel {
      .libraryClose {
        display: grid;
        place-items: center;
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 1px solid var(--el-border-color);
        border-radius: 6px;
        background: var(--el-bg-color);
        color: var(--el-text-color-secondary);
        cursor: pointer;
      }
      display: none;
      position: absolute;
      left: 54px;
      top: 0;
      bottom: 0;
      z-index: 12;
      width: 232px;
      border: 1px solid var(--el-border-color-light);
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.18);
    }
    &.libraryOpen .libraryPanel { display: flex; }
  }
}

@media (prefers-reduced-motion: reduce) {
  .directorWorkspace .stagePanel .viewport .stageLoading .loadingIcon { animation: none; }
}
</style>
