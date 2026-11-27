<template>
  <div class="ecomPage">
    <header class="ecomHeader">
      <div class="headerLeft">
        <button class="backButton" type="button" @click="router.push('/home')">
          <icon-arrow-left :size="16" aria-hidden="true" />
        </button>
        <div>
          <h1>电商套图</h1>
          <p>上传一张商品图，按配方生成多平台尺寸的商拍素材</p>
        </div>
      </div>
      <div class="headerRight">
        <span v-if="mode === 'image' || mode === 'detail'" class="statusChip" :class="{ ready: config?.matting.configured }">
          <i />
          {{ config?.matting.configured ? `抠图已接入 · ${providerLabels[config.matting.provider]}` : "抠图未配置 · 降级模式" }}
        </span>
        <a v-if="config?.canEdit && !config.matting.configured" class="configLink" href="#/admin/settings">去配置</a>
      </div>
    </header>

    <div class="ecomBody">
      <section class="panel formPanel">
        <div class="modeTabs">
          <button class="modeTab" :class="{ active: mode === 'image' }" type="button" @click="mode = 'image'">套图</button>
          <button class="modeTab" :class="{ active: mode === 'video' }" type="button" @click="mode = 'video'">主图视频</button>
          <button class="modeTab" :class="{ active: mode === 'detail' }" type="button" @click="mode = 'detail'">详情页</button>
          <button class="modeTab" :class="{ active: mode === 'talk' }" type="button" @click="mode = 'talk'">口播</button>
          <button class="modeTab" :class="{ active: mode === 'batch' }" type="button" @click="mode = 'batch'">批量</button>
        </div>
        <div class="section">
          <h2>{{ mode === "talk" ? "人物图" : mode === "batch" ? "共享商品图（可选）" : "商品图" }}</h2>
          <div class="uploadBox" :class="{ dragging, filled: !!image }" @click="fileInput?.click()" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
            <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onSelect" />
            <template v-if="image">
              <img :src="image.dataUrl" alt="商品图预览" class="previewImage" />
              <button class="removeImage" type="button" aria-label="移除图片" @click.stop="clearImage">
                <icon-x :size="14" aria-hidden="true" />
              </button>
            </template>
            <template v-else>
              <span class="uploadIcon"><icon-photo-up :size="22" aria-hidden="true" /></span>
              <strong>{{ mode === "talk" ? "点击或拖入主播形象图" : "点击或拖入商品图" }}</strong>
              <span class="uploadHint">{{ mode === "talk" ? "建议正面半身、光线均匀、背景干净，PNG / JPG / WebP，不超过 12 MB" : "建议白底或干净的实拍图，PNG / JPG / WebP，不超过 12 MB" }}</span>
            </template>
          </div>
        </div>

        <div v-if="mode !== 'talk' && mode !== 'batch'" class="section">
          <h2>商品信息</h2>          <el-input v-model="form.title" placeholder="商品标题，例如：白色保温杯" maxlength="200" />
          <el-input v-model="form.category" class="fieldGap" placeholder="类目，例如：家居 / 水杯" maxlength="80" />
          <el-input v-model="form.points" class="fieldGap" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="卖点，用逗号或换行分隔，例如：24 小时保温，轻量便携" maxlength="300" />
        </div>

        <div v-if="mode === 'image'" class="section">
          <h2>出图配方</h2>
          <div class="recipeList">
            <button v-for="recipe in config?.recipes ?? []" :key="recipe.id" class="recipeItem" :class="{ active: form.recipeId === recipe.id }" type="button" @click="selectRecipe(recipe)">
              <span class="recipeTop">
                <strong>{{ recipe.label }}</strong>
                <icon-check v-if="form.recipeId === recipe.id" :size="15" aria-hidden="true" />
              </span>
              <span class="recipeDesc">{{ recipe.description }}</span>
            </button>
          </div>
        </div>

        <div v-if="mode === 'image'" class="section">
          <h2>输出尺寸</h2>
          <el-checkbox-group v-model="form.outputKeys" class="outputList">
            <el-checkbox v-for="preset in currentRecipe?.presets ?? []" :key="presetKey(preset)" :value="presetKey(preset)" border>
              {{ preset.label }}
            </el-checkbox>
          </el-checkbox-group>
          <p class="sectionHint">一次最多生成 4 个尺寸，按所选配方推荐。</p>
          <div class="switchRow gapTop">
            <el-switch v-model="aiLabel" />
            <span class="switchHint">添加「AI 生成」角标与文件元数据</span>
          </div>
        </div>

        <div v-if="mode === 'image' && currentRecipe?.background === 'generated'" class="section">
          <h2>场景与模型</h2>
          <el-input v-model="form.scenePrompt" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="补充场景描述，例如：浅木色桌面，晨光，极简家居" maxlength="2000" />
          <el-select v-model="modelKey" class="fieldGap" placeholder="选择场景生成模型" filterable>
            <el-option v-for="model in imageModels" :key="`${model.providerId}:${model.modelId}`" :label="modelOptionLabel(model)" :value="`${model.providerId}:${model.modelId}`" />
          </el-select>
          <p v-if="isUnconfigured(modelKey)" class="modelWarn">该供应商未配置 API Key，调用会失败。请到「系统设置 → 媒体模型」填写。</p>
          <p class="sectionHint">场景会先生成空镜背景，再把商品合成进去。</p>
        </div>

        <div v-if="mode === 'video'" class="section">
          <h2>视频规格</h2>
          <div class="chipRow">
            <button v-for="item in videoRatios" :key="item.value" class="chip" :class="{ active: videoForm.ratio === item.value }" type="button" @click="videoForm.ratio = item.value">{{ item.label }}</button>
          </div>
          <div class="chipRow">
            <button v-for="item in videoDurations" :key="item" class="chip" :class="{ active: videoForm.duration === item }" type="button" @click="videoForm.duration = item">{{ item }} 秒</button>
          </div>
          <div class="chipRow">
            <button v-for="item in transitionOptions" :key="item.value" class="chip" :class="{ active: videoForm.transition === item.value }" type="button" @click="videoForm.transition = item.value">转场 · {{ item.label }}</button>
          </div>
          <el-select v-model="videoModelKey" class="fieldGap" placeholder="选择图生视频模型" filterable>
            <el-option v-for="model in videoModels" :key="`${model.providerId}:${model.modelId}`" :label="modelOptionLabel(model)" :value="`${model.providerId}:${model.modelId}`" />
          </el-select>
          <p v-if="isUnconfigured(videoModelKey)" class="modelWarn">该供应商未配置 API Key，调用会失败。请到「系统设置 → 媒体模型」填写。</p>
          <el-input v-model="videoForm.prompt" class="fieldGap" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="镜头补充描述，例如：暖光，缓慢推近，突出杯口细节" maxlength="2000" />
          <el-input v-model="videoForm.subtitles" class="fieldGap" type="textarea" :autosize="{ minRows: 2, maxRows: 3 }" placeholder="卖点字幕，每行一条，依次显示在对应镜头" maxlength="180" />
          <div class="bgmRow">
            <input ref="bgmInput" type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" hidden @change="onBgmSelect" />
            <button class="bgmButton" type="button" @click="bgmInput?.click()">
              <icon-music :size="14" aria-hidden="true" />
              {{ bgm ? bgm.name : "上传背景音乐（可选）" }}
            </button>
            <button v-if="bgm" class="bgmRemove" type="button" aria-label="移除背景音乐" @click.stop="bgm = null">
              <icon-x :size="13" aria-hidden="true" />
            </button>
          </div>
          <p class="sectionHint">字幕最多 3 条、每条 60 字；BGM 支持 MP3 / WAV / M4A，≤20 MB，音量会自动压低到 28%。</p>
          <div class="switchRow gapTop">
            <el-switch v-model="aiLabel" />
            <span class="switchHint">在成片左下角烧录「AI 生成」标识</span>
          </div>
          <p v-if="!videoModels.length" class="sectionHint">还没有可用的视频模型，请先在设置中配置供应商。</p>
        </div>

        <div v-if="mode === 'detail'" class="section">
          <h2>长图规格</h2>
          <div class="chipRow">
            <button v-for="item in detailWidths" :key="item" class="chip" :class="{ active: detailForm.width === item }" type="button" @click="detailForm.width = item">宽度 {{ item }}px</button>
          </div>
          <div class="chipRow">
            <button v-for="item in detailStyles" :key="item.value" class="chip" :class="{ active: detailForm.style === item.value }" type="button" @click="detailForm.style = item.value">{{ item.label }}</button>
          </div>
          <p class="sectionHint">按标题与卖点生成「首屏 + 每卖点一屏 + 收尾」并垂直拼接。白底模式不调用图片模型，适合先校验排版。</p>
          <div class="switchRow gapTop">
            <el-switch v-model="aiLabel" />
            <span class="switchHint">添加「AI 生成」角标与文件元数据</span>
          </div>
          <p v-if="detailForm.style === 'scene' && !imageModels.length" class="sectionHint">还没有可用的图片模型，场景模式无法生成背景。</p>
        </div>

        <div v-if="mode === 'talk'" class="section">
          <h2>口播设置</h2>
          <el-input v-model="talkForm.script" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" placeholder="口播文案，建议 80-200 字，例如：这款保温杯采用双层真空结构，24 小时锁温……" maxlength="2000" />
          <div class="chipRow gapTop">
            <button v-for="item in talkRatios" :key="item.value" class="chip" :class="{ active: talkForm.ratio === item.value }" type="button" @click="talkForm.ratio = item.value">{{ item.label }}</button>
          </div>
          <el-select v-model="talkForm.modelKey" class="fieldGap" placeholder="选择语音合成模型" filterable>
            <el-option v-for="model in audioModels" :key="`${model.providerId}:${model.modelId}`" :label="modelOptionLabel(model)" :value="`${model.providerId}:${model.modelId}`" />
          </el-select>
          <p v-if="isUnconfigured(talkForm.modelKey)" class="modelWarn">该供应商未配置 API Key，调用会失败。请到「系统设置 → 媒体模型」填写。</p>
          <el-select v-if="voiceOptions.length" v-model="talkForm.voiceId" class="fieldGap" placeholder="选择音色" filterable>
            <el-option v-for="voice in voiceOptions" :key="voice.voice" :label="voice.title" :value="voice.voice" />
          </el-select>
          <div class="switchRow gapTop">
            <el-switch v-model="talkForm.subtitles" />
            <span class="switchHint">按文案自动切分并烧录字幕</span>
          </div>
          <div class="switchRow gapTop">
            <el-switch v-model="aiLabel" />
            <span class="switchHint">在成片左下角烧录「AI 生成」标识</span>
          </div>
          <p class="sectionHint">当前为静态人物口播：画面轻微推近 + 语音 + 字幕，未做唇形同步。</p>
        </div>

        <div v-if="mode === 'batch'" class="section">
          <h2>批量导入</h2>
          <div class="bgmRow">
            <input ref="csvInput" type="file" accept=".csv,text/csv" hidden @change="onCsvSelect" />
            <button class="bgmButton" type="button" @click="csvInput?.click()">
              <icon-file-text :size="14" aria-hidden="true" />
              {{ csvName || "上传 CSV 文件" }}
            </button>
          </div>
          <el-input
            v-model="batchForm.csv"
            class="fieldGap"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 10 }"
            placeholder="title,category,sellingPoints,imageUrl&#10;白色保温杯,家居,24小时保温|轻量便携,https://..."
            maxlength="20000"
          />
          <p class="sectionHint">最多 20 行。表头支持 title / category / sellingPoints / imageUrl，卖点用 | 分隔；某行没有图片地址时使用上方共享图。</p>
          <p class="fieldLabel">输出类型</p>
          <div class="chipRow">
            <button class="chip" :class="{ active: batchForm.kind === 'image' }" type="button" @click="batchForm.kind = 'image'">商品套图</button>
            <button class="chip" :class="{ active: batchForm.kind === 'video' }" type="button" @click="batchForm.kind = 'video'">主图视频</button>
          </div>

          <template v-if="batchForm.kind === 'image'">
            <p class="fieldLabel">主图风格</p>
            <div class="chipRow">
              <button v-for="item in batchStyles" :key="item.value" class="chip" :class="{ active: batchForm.style === item.value }" type="button" @click="batchForm.style = item.value">{{ item.label }}</button>
            </div>
            <p class="fieldLabel">输出尺寸</p>
            <el-checkbox-group v-model="batchForm.sizeKeys" class="outputList">
              <el-checkbox v-for="size in batchSizes" :key="`${size.width}x${size.height}`" :value="`${size.width}x${size.height}`" border>
                {{ size.label }}
              </el-checkbox>
            </el-checkbox-group>
            <p class="sectionHint">同一商品一次导出多个尺寸（最多 4 个）。场景模式每个 SKU 只生成一张底图，其余尺寸在本地裁切，不会按尺寸重复计费。输出 ZIP：001/1200x1200.jpg… + manifest.csv。</p>
            <div class="switchRow gapTop">
              <el-switch v-model="aiLabel" />
              <span class="switchHint">添加「AI 生成」角标与文件元数据；超限时自动压缩到平台大小上限</span>
            </div>
          </template>

          <template v-else>
            <p class="fieldLabel">视频规格</p>
            <div class="chipRow">
              <button v-for="item in videoRatios" :key="item.value" class="chip" :class="{ active: batchVideo.ratio === item.value }" type="button" @click="batchVideo.ratio = item.value">{{ item.label }}</button>
            </div>
            <div class="chipRow">
              <button v-for="item in videoDurations" :key="item" class="chip" :class="{ active: batchVideo.duration === item }" type="button" @click="batchVideo.duration = item">{{ item }} 秒</button>
            </div>
            <div class="chipRow">
              <button v-for="item in transitionOptions" :key="item.value" class="chip" :class="{ active: batchVideo.transition === item.value }" type="button" @click="batchVideo.transition = item.value">转场 · {{ item.label }}</button>
            </div>
            <div class="switchRow gapTop">
              <el-switch v-model="batchVideo.subtitles" />
              <span class="switchHint">用每行卖点做字幕（最多 3 条）</span>
            </div>
            <div class="switchRow gapTop">
              <el-switch v-model="aiLabel" />
              <span class="switchHint">在成片左下角烧录「AI 生成」标识</span>
            </div>
            <div class="bgmRow gapTop">
              <input ref="batchBgmInput" type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" hidden @change="onBatchBgmSelect" />
              <button class="bgmButton" type="button" @click="batchBgmInput?.click()">
                <icon-music :size="14" aria-hidden="true" />
                {{ batchBgm ? batchBgm.name : "上传背景音乐（可选）" }}
              </button>
              <button v-if="batchBgm" class="bgmRemove" type="button" aria-label="移除背景音乐" @click.stop="batchBgm = null">
                <icon-x :size="13" aria-hidden="true" />
              </button>
            </div>
            <p class="sectionHint">每个 SKU 生成 {{ batchVideoSegments }} 段（每段 5 秒）后拼接，商品保持静止、只让镜头运动。输出 ZIP：001/video-1080x1920.mp4… + manifest.csv。</p>
          </template>
        </div>

        <button class="generateButton" type="button" :disabled="!canGenerate || submitting" @click="generate">
          <span v-if="submitting" class="spinner" aria-hidden="true" />
          {{ submitting ? "正在提交…" : mode === "video" ? "生成主图视频" : mode === "detail" ? "生成详情页" : mode === "talk" ? "生成口播视频" : mode === "batch" ? (batchForm.kind === "video" ? "生成批量视频" : "生成批量套图") : "生成套图" }}
        </button>
        <p v-if="mode === 'image' && !config?.matting.configured" class="degradeHint">
          未配置抠图服务，商品将按原图直接合成，边缘可能不干净。管理员可在「系统设置 → 电商与抠图」中填写 API Key。
        </p>
        <p v-if="estimateHint" class="estimateHint">{{ estimateHint }}</p>
      </section>

      <section class="panel resultPanel">
        <header class="resultHeader">
          <div>
            <h2>生成结果</h2>
            <p>{{ task ? `任务 ${task.id}` : "结果会保留在服务端，可随时回来下载" }}</p>
          </div>
          <span v-if="task" class="statusChip" :class="task.status">{{ taskStatusLabel }}</span>
        </header>

        <div v-if="!task" class="emptyState" :class="{ compact: mode === 'batch' }">
          <span class="emptyIcon"><icon-photo-star :size="26" aria-hidden="true" /></span>
          <strong>还没有生成记录</strong>
          <p>{{ mode === "talk" ? "上传人物图，填写口播文案，点击「生成口播视频」。" : mode === "detail" ? "上传商品图，填写标题与卖点，点击「生成详情页」。" : mode === "batch" ? "粘贴或上传 CSV，点击「生成批量套图」。" : "上传商品图，选择配方与尺寸，点击「生成套图」。" }}</p>
        </div>

        <div v-else-if="task.status === 'queued' || task.status === 'running'" class="runningState">
          <span class="runningSpinner" aria-hidden="true" />
          <strong>{{ task.status === "queued" ? "任务排队中" : "正在生成" }}</strong>
          <p>{{ mode === "video" ? "逐段生成镜头 → 统一规格 → 拼接 → 转场 / BGM / 字幕，通常需要 3-8 分钟。" : mode === "detail" ? "生成首屏与卖点模块 → 合成商品 → 排版文字 → 垂直拼接，通常需要 2-5 分钟。" : mode === "talk" ? "语音合成 → 人物画面推近 → 字幕烧录，通常需要 1-3 分钟。" : mode === "batch" ? (batchForm.kind === "video" ? "逐行生成分段视频 → 拼接与字幕 → 打包 ZIP，每行通常 1-3 分钟。" : "逐行抠图与合成 → 打包 ZIP，通常每行 3-10 秒。") : "抠图 → 场景 → 合成 → 多尺寸导出，通常需要 1-3 分钟。" }}</p>
          <div class="steps">
            <span v-for="(step, index) in steps" :key="step" class="step" :class="{ active: index <= activeStep }">{{ step }}</span>
          </div>
        </div>

        <div v-else-if="task.status === 'failed'" class="errorState">
          <icon-alert-triangle :size="24" aria-hidden="true" />
          <strong>生成失败</strong>
          <p>{{ task.error || "请稍后重试" }}</p>
          <button class="ghostButton" type="button" @click="task = null">重新填写</button>
        </div>

        <template v-else>
          <div v-if="task.warnings.length" class="warningBox">
            <icon-info-circle :size="15" aria-hidden="true" />
            <div>
              <p v-for="warning in task.warnings" :key="warning">{{ warning }}</p>
            </div>
          </div>
          <div v-if="task.type === 'batch'" class="zipCard">
            <span class="zipIcon"><icon-file-zip :size="22" aria-hidden="true" /></span>
            <div class="zipCopy">
              <strong>{{ task.outputs[0]?.label }}</strong>
              <span>{{ task.outputs[0]?.kind === "video" ? "ZIP 按 SKU 分目录：001/video-1080x1920.mp4… + manifest.csv" : "ZIP 按 SKU 分目录：001/1200x1200.jpg… + manifest.csv" }}</span>
            </div>
            <div class="zipActions">
              <a class="downloadLink" :href="task.outputs[0]?.url" download>下载 ZIP</a>
              <button v-if="activeFailedCount" class="zipResume" type="button" :disabled="resuming === task.id" @click="resumeBatch(task.id)">
                {{ resuming === task.id ? "提交中…" : `续跑 ${activeFailedCount} 行` }}
              </button>
            </div>
          </div>
          <div v-else class="assetGrid">
            <article v-for="asset in task.outputs" :key="asset.path" class="assetCard">
              <video v-if="asset.kind === 'video'" class="assetVideo" :src="asset.url" controls playsinline preload="metadata" />
              <img v-else :src="asset.url" :alt="asset.label" :class="{ detailImage: task.type === 'detail' }" loading="lazy" />
              <div class="assetFooter">
                <div class="assetCopy">
                  <strong>{{ asset.label }}</strong>
                  <span>{{ asset.width }} × {{ asset.height }}<template v-if="asset.kind === 'video'"> · {{ asset.duration ?? 0 }}s</template></span>
                </div>
                <a class="downloadLink" :href="asset.url" :download="asset.path">下载</a>
              </div>
            </article>
          </div>
        </template>

        <div v-if="mode === 'batch'" class="historyPanel">
          <div class="historyHead">
            <div>
              <h3>批量历史</h3>
              <p>最近任务，失败行可单独续跑</p>
            </div>
            <div class="historyTools">
              <div v-if="historyPages > 1" class="historyPager">
                <button type="button" :disabled="historyPage <= 1" @click="loadBatchHistory(historyPage - 1)">上一页</button>
                <span>{{ historyPage }}/{{ historyPages }}</span>
                <button type="button" :disabled="historyPage >= historyPages" @click="loadBatchHistory(historyPage + 1)">下一页</button>
              </div>
              <button class="historyRefresh" type="button" @click="loadBatchHistory()">刷新</button>
            </div>
          </div>
          <p v-if="!batchHistory.length" class="historyEmpty">还没有批量任务</p>
          <article v-for="row in batchHistory" :key="row.id" class="historyCard">
            <div class="historyMain">
              <span class="historyDot" :class="row.status" aria-hidden="true" />
              <div class="historyText">
                <strong>{{ formatTime(row.createdAt) }} · {{ row.mode === "video" ? "主图视频" : row.style === "scene" ? "场景主图" : "白底主图" }}</strong>
                <span v-if="row.legacy">旧任务 · 无行级记录，ZIP 仍可下载</span>
                <span v-else>{{ row.sizes.join(" + ") || "—" }} · 成功 {{ row.succeeded }}/{{ row.total }}<template v-if="row.failed">&nbsp;· 失败 {{ row.failed }}</template></span>
              </div>
            </div>
            <div class="historyActions">
              <a v-if="row.zipUrl" class="historyLink" :href="row.zipUrl" download>下载</a>
              <button v-if="row.canResume" class="historyButton" type="button" :disabled="resuming === row.id" @click="resumeBatch(row.id)">
                {{ resuming === row.id ? "提交中…" : "续跑失败行" }}
              </button>
              <button v-if="!row.legacy" class="historyButton" type="button" @click="toggleBatchDetail(row.id)">{{ detailId === row.id ? "收起" : "明细" }}</button>
            </div>
            <ul v-if="detailId === row.id" class="historyRows">
              <li v-if="!batchDetail.length">没有行记录（旧任务）</li>
              <li v-for="item in batchDetail" :key="item.index" :class="item.status">
                <span class="rowTitle">{{ rowLabel(item) }}</span>
                <span class="rowState">{{ rowState(item) }}</span>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { IconAlertTriangle, IconArrowLeft, IconCheck, IconFileText, IconFileZip, IconInfoCircle, IconMusic, IconPhotoStar, IconPhotoUp, IconX } from "@tabler/icons-vue";
import { ecommerceApi, readFileAsBase64, statusLabels, type BatchHistoryItem, type BatchItem, type EcomConfig, type EcomModel, type EcomPreset, type EcomRecipe, type EcomTask } from "@/lib/ecommerce";

const router = useRouter();
const config = ref<EcomConfig | null>(null);
const models = ref<EcomModel[]>([]);
const task = ref<EcomTask | null>(null);
const submitting = ref(false);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement>();
const image = ref<{ dataUrl: string; base64: string; mimeType: string; name: string } | null>(null);
const modelKey = ref("");
const mode = ref<"image" | "video" | "detail" | "talk" | "batch">("image");
const videoModelKey = ref("");
const videoRatios: { value: "9:16" | "1:1" | "16:9"; label: string }[] = [
  { value: "9:16", label: "9:16 竖版" },
  { value: "1:1", label: "1:1 方形" },
  { value: "16:9", label: "16:9 横版" },
];
const videoDurations = [5, 10, 15];
const transitionOptions: { value: "none" | "fade" | "slide"; label: string }[] = [
  { value: "fade", label: "淡入淡出" },
  { value: "slide", label: "滑动" },
  { value: "none", label: "无转场" },
];
const videoForm = reactive<{ ratio: "9:16" | "1:1" | "16:9"; duration: number; prompt: string; transition: "none" | "fade" | "slide"; subtitles: string }>({ ratio: "9:16", duration: 15, prompt: "", transition: "fade", subtitles: "" });
const bgm = ref<{ data: string; mimeType: string; name: string } | null>(null);
const bgmInput = ref<HTMLInputElement>();
const detailWidths = [750, 800];
const detailStyles: { value: "scene" | "white"; label: string }[] = [
  { value: "scene", label: "场景背景" },
  { value: "white", label: "纯白底" },
];
const detailForm = reactive<{ width: number; style: "scene" | "white" }>({ width: 750, style: "scene" });
const talkRatios: { value: "9:16" | "1:1"; label: string }[] = [
  { value: "9:16", label: "9:16 竖版" },
  { value: "1:1", label: "1:1 方形" },
];
const talkForm = reactive<{ script: string; ratio: "9:16" | "1:1"; modelKey: string; voiceId: string; subtitles: boolean }>({
  script: "", ratio: "9:16", modelKey: "", voiceId: "", subtitles: true,
});
const batchStyles: { value: "white" | "scene"; label: string }[] = [
  { value: "white", label: "白底主图" },
  { value: "scene", label: "场景主图" },
];
const batchSizes: EcomPreset[] = [
  { ratio: "1:1", width: 1200, height: 1200, label: "1:1 主图 1200" },
  { ratio: "1:1", width: 800, height: 800, label: "1:1 主图 800" },
  { ratio: "3:4", width: 1242, height: 1656, label: "3:4 小红书 1242×1656" },
  { ratio: "9:16", width: 1080, height: 1920, label: "9:16 抖音 1080×1920" },
  { ratio: "16:9", width: 1920, height: 1080, label: "16:9 横版 1920×1080" },
];
const batchForm = reactive<{ csv: string; style: "white" | "scene"; sizeKeys: string[]; kind: "image" | "video" }>({
  csv: "", style: "white", sizeKeys: ["1200x1200", "1080x1920"], kind: "image",
});
const batchVideo = reactive<{ ratio: "9:16" | "1:1" | "16:9"; duration: number; transition: "none" | "fade" | "slide"; subtitles: boolean }>({
  ratio: "9:16", duration: 5, transition: "fade", subtitles: true,
});
const batchVideoSegments = computed(() => Math.ceil(batchVideo.duration / 5));
const batchBgm = ref<{ data: string; mimeType: string; name: string } | null>(null);
const batchBgmInput = ref<HTMLInputElement>();
const batchHistory = ref<BatchHistoryItem[]>([]);
const historyTotal = ref(0);
const historyPage = ref(1);
const historyPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / 10)));
const aiLabel = ref(true);
const batchDetail = ref<BatchItem[]>([]);
const activeBatchItems = ref<BatchItem[]>([]);
const detailId = ref("");
const resuming = ref("");
const activeFailedCount = computed(() => (task.value?.type === "batch" ? activeBatchItems.value.filter(item => item.status === "failed").length : 0));
const taskStatusLabel = computed(() => {
  if (!task.value) return "";
  // ACT: 批量的 partial 表示有行失败，与出图降级不是同一含义。
  if (task.value.type === "batch" && task.value.status === "partial") return "部分完成";
  return statusLabels[task.value.status];
});
const csvInput = ref<HTMLInputElement>();
const csvName = ref("");
const form = reactive({ title: "", category: "", points: "", recipeId: "lifestyle", outputKeys: [] as string[], scenePrompt: "" });
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const providerLabels: Record<string, string> = { photoroom: "Photoroom", removebg: "Remove.bg", custom: "自定义" };
const supportsImageToVideo = (model: EcomModel) => !model.mode?.length || model.mode.includes("singleImage") || model.mode.includes("startFrameOptional");
const supportsTextToImage = (model: EcomModel) => !model.mode?.length || model.mode.includes("text") || model.mode.includes("singleImage");
const sortConfigured = (left: EcomModel, right: EcomModel) => Number(right.configured !== false) - Number(left.configured !== false);
const imageModels = computed(() => models.value.filter(model => model.type === "image" && supportsTextToImage(model)).sort(sortConfigured));
const videoModels = computed(() => models.value.filter(model => model.type === "video" && supportsImageToVideo(model)).sort(sortConfigured));
const audioModels = computed(() => models.value.filter(model => model.type === "audio").sort(sortConfigured));
const voiceOptions = computed(() => audioModels.value.find(model => `${model.providerId}:${model.modelId}` === talkForm.modelKey)?.voices ?? []);
const currentRecipe = computed<EcomRecipe | undefined>(() => config.value?.recipes.find(recipe => recipe.id === form.recipeId));
const outputPresets = computed<EcomPreset[]>(() => (currentRecipe.value?.presets ?? []).filter(preset => form.outputKeys.includes(presetKey(preset))));
const canGenerate = computed(() => {
  if (!image.value) return false;
  if (mode.value === "video") return !!videoModelKey.value;
  if (mode.value === "detail") return !!form.title.trim() || !!form.points.trim() || detailForm.style === "scene";
  if (mode.value === "talk") return !!talkForm.script.trim() && !!talkForm.modelKey;
  if (mode.value === "batch") return batchForm.csv.trim().length > 4 && (batchForm.kind === "video" || batchForm.sizeKeys.length > 0);
  return !!form.recipeId && outputPresets.value.length > 0;
});
const steps = ["抠图", "场景", "合成", "导出"];
const activeStep = computed(() => task.value?.status === "queued" ? 0 : 2);
const batchRowCount = computed(() => {
  const lines = batchForm.csv.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return 0;
  return Math.max(0, lines.length - (/title|标题/i.test(lines[0]) ? 1 : 0));
});
const pointCount = computed(() => Math.max(1, Math.min(4, form.points.split(/[,，\n]/).map(item => item.trim()).filter(Boolean).length)));
// ACT: 提交前把会真实计费的调用次数算清楚，避免用户对场景模式与分段的成本没有预期。
const estimateHint = computed(() => {
  if (!config.value) return "";
  const matting = config.value.matting.configured;
  const parts: string[] = [];
  if (mode.value === "image") {
    const calls = currentRecipe.value?.background === "generated" ? outputPresets.value.length : 0;
    if (calls) parts.push(`图片模型 ${calls} 次`);
    if (matting) parts.push("抠图 1 次");
    return parts.length ? `预计调用：${parts.join(" · ")}` : "纯本地合成，不调用模型";
  }
  if (mode.value === "video") {
    parts.push(`视频模型 ${Math.ceil(videoForm.duration / 5)} 次`);
    if (matting) parts.push("抠图 1 次");
    return `预计调用：${parts.join(" · ")}`;
  }
  if (mode.value === "detail") {
    if (detailForm.style === "scene") parts.push(`图片模型 ${pointCount.value + 2} 次`);
    if (matting) parts.push("抠图 1 次");
    return parts.length ? `预计调用：${parts.join(" · ")}` : "纯本地排版，不调用模型";
  }
  if (mode.value === "talk") {
    parts.push("语音合成 1 次");
    if (config.value.avatar.configured) parts.push("数字人 1 次");
    return `预计调用：${parts.join(" · ")}`;
  }
  if (mode.value === "batch" && batchRowCount.value) {
    if (batchForm.kind === "video") {
      parts.push(`视频模型 ${batchRowCount.value * batchVideoSegments.value} 次`);
      return `预计调用：${parts.join(" · ")}（共 ${batchRowCount.value} 行 × ${batchVideoSegments.value} 段）`;
    }
    if (batchForm.style === "scene") parts.push(`图片模型 ${batchRowCount.value} 次`);
    if (matting) parts.push(`抠图 ${batchRowCount.value} 次`);
    return parts.length ? `预计调用：${parts.join(" · ")}（共 ${batchRowCount.value} 行）` : `纯本地合成，不调用模型（共 ${batchRowCount.value} 行）`;
  }
  return "";
});

function presetKey(preset: EcomPreset) {
  return `${preset.width}x${preset.height}`;
}

function modelOptionLabel(model: EcomModel) {
  return `${model.providerLabel} · ${model.label}${model.configured === false ? "（未配置）" : ""}`;
}

function isUnconfigured(key: string) {
  if (!key) return false;
  const model = models.value.find(item => `${item.providerId}:${item.modelId}` === key);
  return model?.configured === false;
}

function selectRecipe(recipe: EcomRecipe) {
  form.recipeId = recipe.id;
  form.outputKeys = recipe.presets.slice(0, 2).map(presetKey);
}

function onSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void loadFile(file);
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
}

async function loadFile(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return void ElMessage.error("仅支持 PNG / JPG / WebP");
  if (file.size > 12 * 1024 * 1024) return void ElMessage.error("图片不能超过 12 MB");
  const base64 = await readFileAsBase64(file);
  image.value = { dataUrl: URL.createObjectURL(file), base64, mimeType: file.type, name: file.name };
}

function clearImage() {
  image.value = null;
  if (fileInput.value) fileInput.value.value = "";
}

async function onBgmSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!/^audio\/[a-z0-9.+-]+$/i.test(file.type)) return void ElMessage.error("仅支持音频文件");
  if (file.size > 20 * 1024 * 1024) return void ElMessage.error("背景音乐不能超过 20 MB");
  const base64 = await readFileAsBase64(file);
  bgm.value = { data: base64, mimeType: file.type, name: file.name };
}

async function onBatchBgmSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!/^audio\/[a-z0-9.+-]+$/i.test(file.type)) return void ElMessage.error("仅支持音频文件");
  if (file.size > 20 * 1024 * 1024) return void ElMessage.error("背景音乐不能超过 20 MB");
  const base64 = await readFileAsBase64(file);
  batchBgm.value = { data: base64, mimeType: file.type, name: file.name };
}

async function onCsvSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 200 * 1024) return void ElMessage.error("CSV 不能超过 200 KB");
  batchForm.csv = await file.text();
  csvName.value = file.name;
}

async function generate() {
  if (!image.value || !canGenerate.value) return;
  if (mode.value === "video" && !videoModelKey.value) return void ElMessage.error("请选择视频生成模型");
  submitting.value = true;
  try {
    const points = form.points.split(/[,，\n]/).map(item => item.trim()).filter(Boolean).slice(0, 8);
    const images = [{ data: image.value.base64, mimeType: image.value.mimeType, name: image.value.name }];
    const brief = { title: form.title.trim() || undefined, category: form.category.trim() || undefined, sellingPoints: points.length ? points : undefined };
    let created: { id: string };
    if (mode.value === "video") {
      const [providerId, modelId] = videoModelKey.value.split(":");
      created = await ecommerceApi.createVideo({
        images,
        brief,
        ratio: videoForm.ratio,
        duration: videoForm.duration,
        prompt: videoForm.prompt.trim() || undefined,
        transition: videoForm.transition,
        subtitles: videoForm.subtitles.split(/\r?\n/).map(item => item.trim()).filter(Boolean).slice(0, 3),
        ...(bgm.value ? { bgm: { data: bgm.value.data, mimeType: bgm.value.mimeType } } : {}),
        providerId,
        modelId,
        aiLabel: aiLabel.value,
      });
      task.value = { id: created.id, type: "video", status: "queued", recipeId: "video", outputs: [], warnings: [], error: null, createdAt: Date.now(), updatedAt: Date.now() };
    } else if (mode.value === "detail") {
      const [providerId, modelId] = modelKey.value ? modelKey.value.split(":") : [undefined, undefined];
      created = await ecommerceApi.createDetail({
        images,
        brief,
        width: detailForm.width,
        style: detailForm.style,
        aiLabel: aiLabel.value,
        ...(detailForm.style === "scene" ? { providerId, modelId } : {}),
      });
      task.value = { id: created.id, type: "detail", status: "queued", recipeId: "detail", outputs: [], warnings: [], error: null, createdAt: Date.now(), updatedAt: Date.now() };
    } else if (mode.value === "talk") {
      const [providerId, modelId] = talkForm.modelKey.split(":");
      created = await ecommerceApi.createTalk({
        images,
        script: talkForm.script.trim(),
        ratio: talkForm.ratio,
        voice: { providerId, modelId, voice: talkForm.voiceId || undefined },
        subtitles: talkForm.subtitles,
        aiLabel: aiLabel.value,
      });
      task.value = { id: created.id, type: "talk", status: "queued", recipeId: "talk", outputs: [], warnings: [], error: null, createdAt: Date.now(), updatedAt: Date.now() };
    } else if (mode.value === "batch") {
      created = await ecommerceApi.createBatch({
        csv: batchForm.csv,
        style: batchForm.style,
        aiLabel: aiLabel.value,
        ...(batchForm.kind === "video"
          ? {
              video: {
                ratio: batchVideo.ratio,
                duration: batchVideo.duration,
                transition: batchVideo.transition,
                subtitles: batchVideo.subtitles,
                ...(batchBgm.value ? { bgm: { data: batchBgm.value.data, mimeType: batchBgm.value.mimeType } } : {}),
              },
            }
          : {
              targets: batchSizes
                .filter(size => batchForm.sizeKeys.includes(`${size.width}x${size.height}`))
                .map(size => ({ ratio: size.ratio, width: size.width, height: size.height })),
            }),
        ...(image.value ? { sharedImage: { data: image.value.base64, mimeType: image.value.mimeType } } : {}),
        ...(batchForm.kind === "image" && batchForm.style === "scene" && modelKey.value ? { providerId: modelKey.value.split(":")[0], modelId: modelKey.value.split(":")[1] } : {}),
      });
      task.value = { id: created.id, type: "batch", status: "queued", recipeId: "batch", outputs: [], warnings: [], error: null, createdAt: Date.now(), updatedAt: Date.now() };
      activeBatchItems.value = [];
      historyPage.value = 1;
    } else {
      const [providerId, modelId] = modelKey.value ? modelKey.value.split(":") : [undefined, undefined];
      created = await ecommerceApi.createTask({
        images,
        brief,
        recipeId: form.recipeId,
        outputs: outputPresets.value.map(preset => ({ ratio: preset.ratio, width: preset.width, height: preset.height, label: preset.label })),
        scenePrompt: form.scenePrompt.trim() || undefined,
        providerId,
        modelId,
        aiLabel: aiLabel.value,
      });
      task.value = { id: created.id, type: "image", status: "queued", recipeId: form.recipeId, outputs: [], warnings: [], error: null, createdAt: Date.now(), updatedAt: Date.now() };
    }
    void poll(created.id);
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "提交失败");
  } finally {
    submitting.value = false;
  }
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function loadBatchHistory(page = historyPage.value) {
  try {
    const data = await ecommerceApi.batchHistory(page, 10);
    batchHistory.value = data.items;
    historyTotal.value = data.total;
    historyPage.value = data.page;
    if (!data.items.length && data.page > 1 && data.total > 0) void loadBatchHistory(data.page - 1);
  } catch {
    // ACT: 历史列表加载失败不影响生成主流程。
  }
}

function rowLabel(item: BatchItem) {
  return `${String(item.index + 1).padStart(3, "0")} ${item.title}`;
}

function rowState(item: BatchItem) {
  if (item.status === "succeeded") return `${item.files.length} 张`;
  if (item.status === "running") return "生成中";
  if (item.status === "pending") return "未执行";
  return item.error || "失败";
}

async function toggleBatchDetail(id: string) {
  if (detailId.value === id) {
    detailId.value = "";
    return;
  }
  detailId.value = id;
  batchDetail.value = [];
  try {
    batchDetail.value = (await ecommerceApi.batchItems(id)).items;
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "加载明细失败");
  }
}

async function resumeBatch(id: string) {
  if (resuming.value) return;
  resuming.value = id;
  try {
    const result = await ecommerceApi.batchResume({ id });
    const detail = await ecommerceApi.status(id).catch(() => null);
    if (detail) task.value = { ...detail, status: "queued" };
    activeBatchItems.value = [];
    mode.value = "batch";
    ElMessage.success(`已加入队列，将重跑 ${result.rows} 行`);
    void poll(id);
    void loadBatchHistory();
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "续跑失败");
  } finally {
    resuming.value = "";
  }
}

async function poll(id: string) {
  clearTimeout(pollTimer);
  try {
    const next = await ecommerceApi.status(id);
    task.value = next;
    if (["succeeded", "partial", "failed"].includes(next.status)) {
      if (next.type === "batch") {
        activeBatchItems.value = (await ecommerceApi.batchItems(id).catch(() => ({ items: [] as BatchItem[] }))).items;
        if (detailId.value === id) {
          void ecommerceApi.batchItems(id).then(data => { batchDetail.value = data.items; }).catch(() => {});
        }
        void loadBatchHistory();
      }
      if (next.status === "failed") ElMessage.error(next.error || "生成失败");
      else ElMessage.success(next.status === "partial" ? "生成完成（部分为降级处理）" : "生成完成");
      return;
    }
  } catch {
    // ACT: 轮询失败不中断，下一轮继续。
  }
  pollTimer = setTimeout(() => void poll(id), 1800);
}

onMounted(async () => {
  try {
    const [loaded, modelList] = await Promise.all([ecommerceApi.config(), ecommerceApi.models()]);
    config.value = loaded;
    models.value = modelList;
    const initial = loaded.recipes.find(recipe => recipe.id === "lifestyle") ?? loaded.recipes[0];
    if (initial) selectRecipe(initial);
    const first = modelList.find(model => model.type === "image" && model.configured !== false) ?? modelList.find(model => model.type === "image");
    if (first) modelKey.value = `${first.providerId}:${first.modelId}`;
    const firstVideo = modelList.find(model => model.type === "video" && model.configured !== false) ?? modelList.find(model => model.type === "video");
    if (firstVideo) videoModelKey.value = `${firstVideo.providerId}:${firstVideo.modelId}`;
    const firstAudio = modelList.find(model => model.type === "audio" && model.configured !== false) ?? modelList.find(model => model.type === "audio");
    if (firstAudio) {
      talkForm.modelKey = `${firstAudio.providerId}:${firstAudio.modelId}`;
      talkForm.voiceId = firstAudio.voices?.[0]?.voice ?? "";
    }
    void loadBatchHistory();
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "加载配置失败");
  }
});

onBeforeUnmount(() => clearTimeout(pollTimer));
watch(() => talkForm.modelKey, () => { talkForm.voiceId = voiceOptions.value[0]?.voice ?? ""; });
watch(mode, value => { if (value === "batch") void loadBatchHistory(); });
</script>

<style scoped>
.ecomPage { min-height: 100vh; padding: 22px 30px 40px; background: var(--el-bg-color-page); }
.ecomHeader { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.headerLeft { display: flex; align-items: center; gap: 12px; }
.backButton { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--el-border-color); border-radius: 8px; background: var(--el-bg-color); color: var(--el-text-color-regular); cursor: pointer; }
.backButton:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.headerLeft h1 { margin: 0 0 2px; font-size: 19px; font-weight: 600; letter-spacing: -0.2px; }
.headerLeft p { margin: 0; color: var(--el-text-color-placeholder); font-size: 11.5px; }
.headerRight { display: flex; align-items: center; gap: 10px; }
.statusChip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; background: rgba(224, 162, 74, 0.12); color: #a5691d; font-size: 11px; }
.statusChip i { width: 5px; height: 5px; border-radius: 50%; background: #e0a24a; }
.statusChip.ready { background: rgba(63, 191, 180, 0.12); color: #2f9e94; }
.statusChip.ready i { background: #3fbfb4; }
.statusChip.succeeded, .statusChip.partial { background: rgba(63, 191, 180, 0.12); color: #2f9e94; }
.statusChip.failed { background: rgba(239, 107, 107, 0.12); color: #d25555; }
.configLink { color: var(--el-color-primary); font-size: 11.5px; text-decoration: none; }
.ecomBody { display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 16px; align-items: start; }
.panel { padding: 18px 20px; border: 1px solid var(--el-border-color-lighter); border-radius: 12px; background: var(--el-bg-color); }
.modeTabs { display: flex; gap: 4px; margin-bottom: 18px; padding: 3px; border-radius: 9px; background: var(--el-fill-color-light); }
.modeTab { flex: 1; height: 30px; border: 0; border-radius: 7px; background: transparent; color: var(--el-text-color-secondary); font-size: 12px; cursor: pointer; }
.modeTab.active { background: var(--el-bg-color); color: var(--el-text-color-primary); font-weight: 500; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08); }
.chipRow { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.gapTop { margin-top: 10px; }
.chip { padding: 5px 11px; border: 1px solid var(--el-border-color); border-radius: 20px; background: transparent; color: var(--el-text-color-regular); font-size: 11.5px; cursor: pointer; transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease; }
.chip:hover { border-color: var(--el-color-primary); }
.chip.active { border-color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 12%, transparent); color: var(--el-color-primary); }
.bgmRow { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.bgmButton { display: flex; align-items: center; gap: 7px; max-width: 100%; height: 32px; padding: 0 11px; overflow: hidden; border: 1px dashed var(--el-border-color); border-radius: 8px; background: transparent; color: var(--el-text-color-regular); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.bgmButton:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.bgmRemove { display: grid; place-items: center; width: 26px; height: 26px; flex-shrink: 0; border: 1px solid var(--el-border-color); border-radius: 50%; background: transparent; color: var(--el-text-color-secondary); cursor: pointer; }
.bgmRemove:hover { border-color: var(--el-color-danger); color: var(--el-color-danger); }
.section { margin-bottom: 20px; }
.section h2 { margin: 0 0 10px; font-size: 12.5px; font-weight: 600; }
.fieldGap { margin-top: 8px; }
.sectionHint { margin: 8px 0 0; color: var(--el-text-color-placeholder); font-size: 10.5px; line-height: 1.6; }
.fieldLabel { margin: 14px 0 7px; color: var(--el-text-color-regular); font-size: 12px; font-weight: 600; }
.uploadBox { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 160px; padding: 16px; border: 1px dashed var(--el-border-color); border-radius: 10px; background: var(--el-fill-color-lighter); cursor: pointer; transition: border-color 0.16s ease, background 0.16s ease; }
.uploadBox:hover, .uploadBox.dragging { border-color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 5%, var(--el-fill-color-lighter)); }
.uploadBox.filled { padding: 0; border-style: solid; overflow: hidden; background: #fff; }
.uploadIcon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: var(--el-fill-color); color: var(--el-text-color-secondary); }
.uploadBox strong { font-size: 12.5px; font-weight: 500; }
.uploadHint { max-width: 260px; color: var(--el-text-color-placeholder); font-size: 10.5px; line-height: 1.6; text-align: center; }
.previewImage { display: block; width: 100%; max-height: 260px; object-fit: contain; }
.removeImage { position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff; cursor: pointer; }
.recipeList { display: flex; flex-direction: column; gap: 8px; }
.recipeItem { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 9px; background: transparent; text-align: left; cursor: pointer; transition: border-color 0.16s ease, background 0.16s ease; }
.recipeItem:hover { border-color: var(--el-border-color); }
.recipeItem.active { border-color: var(--el-color-primary); background: color-mix(in srgb, var(--el-color-primary) 6%, transparent); }
.recipeTop { display: flex; align-items: center; justify-content: space-between; color: var(--el-color-primary); }
.recipeTop strong { color: var(--el-text-color-primary); font-size: 12.5px; font-weight: 500; }
.recipeDesc { color: var(--el-text-color-placeholder); font-size: 10.5px; line-height: 1.55; }
.outputList { display: flex; flex-wrap: wrap; gap: 8px; }
.outputList :deep(.el-checkbox) { margin-right: 0; }
.generateButton { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 42px; border: 0; border-radius: 9px; background: var(--el-color-primary); color: #fff; font-size: 13px; font-weight: 500; cursor: pointer; box-shadow: 0 8px 20px color-mix(in srgb, var(--el-color-primary) 28%, transparent); }
.generateButton:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
.spinner { width: 13px; height: 13px; border: 2px solid rgba(255, 255, 255, 0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
.degradeHint { margin: 10px 0 0; padding: 9px 10px; border-radius: 8px; background: rgba(224, 162, 74, 0.09); color: #a5691d; font-size: 10.5px; line-height: 1.6; }
.modelWarn { margin: 6px 0 0; padding: 7px 9px; border-radius: 7px; background: rgba(217, 83, 79, 0.09); color: #c0504d; font-size: 10.5px; line-height: 1.55; }
.estimateHint { margin: 9px 0 0; color: var(--el-text-color-placeholder); font-size: 10.5px; line-height: 1.6; }
.resultPanel { min-height: 520px; }
.resultHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.resultHeader h2 { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
.resultHeader p { margin: 0; color: var(--el-text-color-placeholder); font-size: 10.5px; }
.emptyState, .runningState, .errorState { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 420px; text-align: center; }
.emptyState.compact { min-height: 150px; padding: 12px 0 4px; }
.emptyIcon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 14px; background: var(--el-fill-color-light); color: var(--el-text-color-placeholder); }
.emptyState strong, .runningState strong, .errorState strong { font-size: 13px; font-weight: 500; }
.emptyState p, .runningState p, .errorState p { max-width: 360px; margin: 0; color: var(--el-text-color-placeholder); font-size: 11.5px; line-height: 1.7; }
.runningSpinner { width: 34px; height: 34px; border: 3px solid var(--el-border-color-lighter); border-top-color: var(--el-color-primary); border-radius: 50%; animation: spin 0.9s linear infinite; }
.steps { display: flex; gap: 6px; margin-top: 8px; }
.step { padding: 3px 9px; border-radius: 20px; background: var(--el-fill-color-light); color: var(--el-text-color-placeholder); font-size: 10px; }
.step.active { background: color-mix(in srgb, var(--el-color-primary) 14%, transparent); color: var(--el-color-primary); }
.errorState { color: var(--el-color-danger); }
.ghostButton { margin-top: 8px; padding: 6px 14px; border: 1px solid var(--el-border-color); border-radius: 7px; background: transparent; color: var(--el-text-color-regular); font-size: 11.5px; cursor: pointer; }
.warningBox { display: flex; gap: 8px; margin-bottom: 14px; padding: 10px 12px; border-radius: 9px; background: rgba(224, 162, 74, 0.08); color: #a5691d; font-size: 10.5px; line-height: 1.65; }
.warningBox p { margin: 0; }
.zipCard { display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-fill-color-lighter); }
.zipIcon { display: grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; border-radius: 10px; background: var(--el-bg-color); color: var(--el-text-color-secondary); }
.zipCopy { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.zipCopy strong { font-size: 12.5px; font-weight: 500; }
.zipCopy span { color: var(--el-text-color-placeholder); font-size: 10.5px; }
.assetGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.assetCard { overflow: hidden; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-bg-color); }
.assetCard img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: contain; background: var(--el-fill-color-lighter); }
.assetVideo { display: block; width: 100%; max-height: 420px; background: #000; }
.detailImage { aspect-ratio: auto !important; max-height: 720px; object-fit: contain; }
.assetFooter { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; }
.assetCopy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.assetCopy strong { overflow: hidden; font-size: 11.5px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.assetCopy span { color: var(--el-text-color-placeholder); font-size: 10px; font-variant-numeric: tabular-nums; }
.downloadLink { flex-shrink: 0; color: var(--el-color-primary); font-size: 11.5px; text-decoration: none; }
.downloadLink:hover { text-decoration: underline; }
.zipActions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.zipResume { padding: 5px 10px; border: 0; border-radius: 7px; background: color-mix(in srgb, var(--el-color-primary) 13%, transparent); color: var(--el-color-primary); font-size: 11px; cursor: pointer; }
.zipResume:disabled { opacity: 0.55; cursor: not-allowed; }
.historyPanel { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--el-border-color-lighter); }
.historyHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.historyHead h3 { margin: 0 0 3px; font-size: 13px; font-weight: 600; }
.historyHead p { margin: 0; color: var(--el-text-color-placeholder); font-size: 10.5px; }
.historyRefresh { padding: 4px 10px; border: 1px solid var(--el-border-color); border-radius: 7px; background: transparent; color: var(--el-text-color-regular); font-size: 11px; cursor: pointer; }
.historyTools { display: flex; align-items: center; gap: 8px; }
.historyPager { display: flex; align-items: center; gap: 6px; color: var(--el-text-color-placeholder); font-size: 10.5px; }
.historyPager button { padding: 3px 8px; border: 1px solid var(--el-border-color); border-radius: 6px; background: transparent; color: var(--el-text-color-regular); font-size: 10.5px; cursor: pointer; }
.historyPager button:disabled { opacity: 0.45; cursor: not-allowed; }
.historyEmpty { margin: 0; color: var(--el-text-color-placeholder); font-size: 10.5px; }
.historyCard { margin-bottom: 8px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-fill-color-lighter); }
.historyCard:last-child { margin-bottom: 0; }
.historyMain { display: flex; align-items: flex-start; gap: 9px; }
.historyDot { flex: none; width: 8px; height: 8px; margin-top: 4px; border-radius: 50%; background: var(--el-text-color-placeholder); }
.historyDot.succeeded { background: #3f9c6b; }
.historyDot.partial { background: #d9a441; }
.historyDot.failed { background: #d9534f; }
.historyDot.queued, .historyDot.running { background: var(--el-color-primary); }
.historyText { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.historyText strong { font-size: 12px; font-weight: 500; }
.historyText span { color: var(--el-text-color-placeholder); font-size: 10.5px; }
.historyActions { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-left: 17px; }
.historyLink { color: var(--el-color-primary); font-size: 11px; text-decoration: none; }
.historyLink:hover { text-decoration: underline; }
.historyButton { padding: 3px 9px; border: 1px solid var(--el-border-color); border-radius: 6px; background: transparent; color: var(--el-text-color-regular); font-size: 11px; cursor: pointer; }
.historyButton:disabled { opacity: 0.55; cursor: not-allowed; }
.historyRows { display: flex; flex-direction: column; gap: 5px; max-height: 180px; margin: 8px 0 0; padding: 8px 0 0; border-top: 1px dashed var(--el-border-color-lighter); list-style: none; overflow: auto; }
.historyRows li { display: flex; justify-content: space-between; gap: 10px; color: var(--el-text-color-placeholder); font-size: 10.5px; }
.historyRows li.failed .rowState { color: #d9534f; }
.historyRows li.succeeded .rowState { color: #3f9c6b; }
.rowTitle { color: var(--el-text-color-regular); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rowState { flex: none; max-width: 55%; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1080px) { .ecomBody { grid-template-columns: 1fr; } .ecomPage { padding: 16px; } }
</style>
