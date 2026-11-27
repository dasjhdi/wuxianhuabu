# 电商套图

面向电商商品的批量出图能力：上传一张商品图，按配方生成白底主图、生活场景、棚拍等多种素材，并导出多平台尺寸。

## 入口

- 创作首页左侧栏 →「电商套图」，或直接访问 `#/ecommerce`
- 所有已登录成员可用；抠图密钥与默认模型由管理员配置
- 模型下拉会标注「（未配置）」的供应商，并优先排列已配置的模型；选中未配置项时表单会提示调用会失败

## 使用流程

1. 上传商品图（PNG / JPG / WebP，≤12 MB，建议白底或干净实拍）
2. 填写商品标题、类目、卖点（卖点会进入场景提示词）
3. 选择出图配方
4. 勾选输出尺寸（最多 4 个）
5. 点击「生成套图」，等待 1-3 分钟，结果可直接下载

## 主图视频

同一个工作台切换到「主图视频」：

1. 上传商品图，填写商品信息
2. 选择画幅（9:16 / 1:1 / 16:9）与时长（5 / 10 / 15 秒）
3. 选择支持图生视频的模型，可补充镜头描述
4. 生成后得到按目标规格拼接好的 MP4

实现方式：按 5 秒一段生成镜头（最多 3 段），每段使用商品图作为首帧，镜头提示词固定为「hero / close-up / orbit」三种缓慢运镜，最后统一缩放、裁切、补边、30fps，再用 concat 或 xfade 拼接。商品保持静止、只让镜头运动，是当前模型下稳定性最高的做法。

后期能力：

| 能力 | 说明 |
| --- | --- |
| 转场 | 0.6 秒淡入淡出 / 滑动 / 无；xfade 拼接会自动扣减重叠时长 |
| BGM | 上传 MP3 / WAV / M4A（≤20 MB），循环铺满并按 28% 音量混音 |
| 卖点字幕 | 最多 3 条，按镜头时间分配，白字 + 半透明底烧录在画面下方 74% 处；自动查找系统中文字体 |

时长会按所选模型的档位就近取整（例如模型只有 4/6/8 秒时取 4 秒），实际成片时长以任务返回的 `duration` 为准。

## 详情页长图

同一工作台切到「详情页」：

- 宽度：750 / 800 px
- 风格：场景背景（调用图片模型）/ 纯白底（本地生成，零模型费用）
- 结构：首屏 1000px（标题 + 类目 + 商品）、每个卖点 900px（序号 + 卖点 + 商品）、收尾 600px（品质保障文案）
- 最多 4 个卖点，卖点来自「商品信息 → 卖点」
- 输出：`detail-<width>.jpg`，垂直拼接的整张长图，同时保留每屏的 `module-*.png`

文字会自动折行（最多两行），白底模式用深色字、场景模式用白字加底框，位置固定在每屏顶部安全区，避免与商品图重叠。

## 口播视频

同一工作台切到「口播」：

1. 上传主播/人物形象图
2. 填写口播文案（建议 80-200 字）
3. 选择比例（9:16 / 1:1）与语音合成模型
4. 可选自动字幕

实现方式：TTS 生成语音 → 读取音频时长 → 人物图轻微推近（zoompan，1.0→1.07）→ 按文案标点切句、均分时间烧录字幕 → 合并音轨输出 MP4。

**未配置数字人服务时**为静态人物口播：画面会缓慢推近，有语音与字幕，但没有唇形同步。配置 D-ID 或自定义服务后会自动切换为真数字人。

### 数字人服务（可选）

后台「系统设置 → 电商与抠图 → 数字人服务」：

| 服务 | 行为 |
| --- | --- |
| 不启用 | 静态人物口播（推近 + 语音 + 字幕） |
| D-ID | 上传图片与音频到 D-ID，创建 talk，轮询结果并下载视频 |
| 自定义接口 | `POST <endpoint>`（multipart：`image`、`audio`）返回 `{ id }` 或 `{ url }`；轮询 `GET <endpoint>/<id>` 返回 `{ status, url }` |

启用后口播任务会优先走数字人服务；提交、轮询或下载失败会自动回退为静态口播，并在任务 `warnings` 中说明原因，不会让任务整体失败。数字人视频会统一到目标画幅、保留原音轨，再按需烧录字幕。

## 批量 SKU

同一工作台切到「批量」：

- 上传或粘贴 CSV，最多 20 行
- 表头支持 `title / category / sellingPoints / imageUrl`（也识别中文表头）
- 卖点用 `|` 或 `;` 分隔
- 某行没有 `imageUrl` 时使用页面上方的「共享商品图」
- 风格：白底主图（本地，零模型费用）/ 场景主图（每行调用一次图片模型）
- 输出尺寸可多选（最多 4 个）：1:1 1200、1:1 800、3:4 1242×1656、9:16 1080×1920、16:9 1920×1080；默认同时导出 1:1 与 9:16
- 输出 ZIP 按 SKU 行分目录：

```text
batch-2.zip
├── 001/1200x1200.jpg
├── 001/1080x1920.jpg
├── 002/1200x1200.jpg
├── 002/1080x1920.jpg
└── manifest.csv
```

`manifest.csv` 表头为 `folder,title,category,sellingPoints,<w>x<h>...`，每个尺寸一列，值为 `001/1200x1200.jpg`；目录用纯序号，标题对应关系只放在清单里，避免 Windows 解压中文乱码。

多尺寸不会放大模型费用：场景模式下每个 SKU 只按面积最大的规格生成一张底图，其余尺寸用 ffmpeg 缩放裁切后本地合成。

逐行失败不会中断整批，失败原因会汇总到任务 `warnings`；全部失败时任务标记为 `failed`。

### 批量主图视频

批量模式的「输出类型」可切到「主图视频」：

- 画幅 9:16 / 1:1 / 16:9，时长 5 / 10 / 15 秒（每 5 秒一段，最多 3 段）
- 转场与单条视频一致（淡入淡出 / 滑动 / 无，固定 0.6 秒）
- 每行的 `sellingPoints` 自动作为卖点字幕，最多 3 条
- 可上传一条 BGM，整批复用
- 输出 ZIP：`001/video-1080x1920.mp4`、`002/…` + `manifest.csv`（`folder,title,category,sellingPoints,video`）

视频按行串行生成，每行会真实调用「段数」次视频模型；20 行 × 3 段意味着 60 次调用，建议先用 1 行 5 秒试跑。

### 历史与断点续跑

批量模式下，结果区下方会列出批量任务（每页 10 条，可翻页），显示时间、类型、尺寸、成功/失败行数，可下载 ZIP、展开行明细、对失败行续跑。

- 每行的状态、错误、产物路径记录在 `ecommerce_batch_items` 表，服务重启后仍可追溯
- 「续跑失败行」只重跑状态不是 `succeeded` 的行，已成功的行直接复用磁盘产物
- 续跑完成后会重新打包 ZIP：已成功行 + 本次重跑成功的行一起进入新 ZIP，旧 ZIP 自动删除
- 续跑失败仍会把错误写回该行，任务保持 `partial`，可再次续跑
- 原始 CSV、风格、尺寸、场景模型、视频参数、共享商品图与 BGM 都会保存到 `data/ecommerce/<taskId>/`，不需要重新上传
- 2026-11-25 之前创建的旧任务没有行级记录，历史里标记为「旧任务」，只能下载，不能续跑

### 任务取消与删除

- 任务卡片支持「取消」：排队中的任务直接跳过，执行中的任务在下一个检查点退出；已发出的模型请求无法中断，但结果不会落盘
- 结束的任务可删除：同时删除数据库记录与 `data/ecommerce/<taskId>/` 目录
- 服务重启时，遗留的 `queued/running` 任务会被标记为失败并提示「服务重启导致任务中断」，批量任务可直接续跑

## AI 标识与平台规格

- 套图、批量套图、详情页、主图视频、批量视频、口播默认开启「AI 生成」标识：画面左下角小字，图片写入 JPEG Comment（`AI-generated content`），视频写入 MP4 `comment` 元数据
- 套图与批量导出都会按规格压缩到平台常见上限：1200/1242/1080/1920 长边为 3MB，800 为 1MB，2000（亚马逊）为 10MB；超限时逐级降低 JPEG 质量，压缩结果写入任务 `warnings`
- 套图成品统一输出 JPEG（`final-<w>x<h>.jpg`），不再输出 PNG；需要无损素材请保留中间 `cutout.png` 与背景图
- 视频标识依赖系统中文字体（与字幕一致），字体缺失时会跳过并写入 warnings

### 白底纯度与主体占比校验

白底主图（套图与批量）生成后会额外做两项自检，结果写入任务 `warnings`，统一以 `【合规】` 开头：

- **白底纯度**：取画面上沿 3% 的像素统计，要求平均亮度 ≥250 且 U/V 接近中性（±6）。纯白背景通常为 100%，降级合成或压缩过度时会偏低
- **主体占比**：读取抠图 PNG 的 alpha 通道，计算商品真实边界，再按 compose 的缩放规则换算到每个画布。展示宽度/高度占比，建议区间 60%–90%；低于 60% 提示「存在主体偏小」，超过 92% 提示「存在贴边」
- 只在白底配方执行；场景配方背景本身有内容，不计算占比
- 未配置或抠图失败（降级）时跳过占比校验，并明确提示原因
- 每行多两次 ffmpeg 探测（尺寸 + alpha 边界），20 行批量大约多 5-10 秒

## 配方

| 配方 | 背景 | 说明 |
| --- | --- | --- |
| 白底主图 | 纯白（本地生成，不调用模型） | 平台首图与规范审核 |
| 生活场景 | 模型生成空镜 | 第二张与种草图 |
| 质感棚拍 | 模型生成空镜 | 高客单价品牌 |
| 模特展示（实验） | 模型生成带人物场景 | 人物与商品位置需人工筛选 |

尺寸预设覆盖 1:1（800/1200/2000）、3:4（1242×1656）、9:16（1080×1920）、16:9（1920×1080）。

## 抠图配置

后台「系统设置 → 电商与抠图」：

| 服务 | 说明 |
| --- | --- |
| Photoroom | 官方 `image-api.photoroom.com/v2/edit`，质量最好 |
| Remove.bg | 官方 `api.remove.bg/v1.0/removebg`，接入简单 |
| 自定义接口 | `POST` multipart（字段名 `image`），`Authorization: Bearer <key>`，返回 PNG 或 `{ url }` |

密钥只保存在服务端 `data/settings.json` 的 `settings.ecommerce` 字段，接口不会回传；只读账号读取设置时会被脱敏。

**未配置密钥时**任务仍可执行，但会走降级方案：原图直接合成并用 `colorkey` 去白底，商品边缘与浅色区域可能不准确，任务状态标记为「已完成（降级）」。

## 接口

所有接口在登录态下访问，响应统一为 `{ code, data, message }`。

### 读取配置

```http
GET /api/ecommerce/config
```

返回 `matting`（provider、configured、endpoint）、`scene`（默认模型）、`recipes`、`presets`、`canEdit`。

### 保存配置（仅管理员）

```http
PUT /api/ecommerce/configSave
Content-Type: application/json

{
  "matting": { "provider": "photoroom", "apiKey": "xxx", "endpoint": "" },
  "scene": { "providerId": "kunrou", "modelId": "gemini-3.1-flash-image" }
}
```

`apiKey` 省略表示保持原值，传空字符串表示清空。

### 创建任务

```http
POST /api/ecommerce/tasks
Content-Type: application/json

{
  "images": [{ "data": "<base64>", "mimeType": "image/png", "name": "product.png" }],
  "brief": { "title": "白色保温杯", "category": "家居 / 水杯", "sellingPoints": ["24 小时保温", "轻量便携"] },
  "recipeId": "lifestyle",
  "outputs": [{ "ratio": "1:1", "width": 1200, "height": 1200 }],
  "scenePrompt": "浅木色桌面，晨光",
  "providerId": "kunrou",
  "modelId": "gemini-3.1-flash-image",
  "aiLabel": true
}
```

返回 `202 { id, status: "queued" }`。任务串行执行，避免并发占用 ffmpeg 与模型额度。`aiLabel` 默认 `true`，成品为 `final-<w>x<h>.jpg`，按平台上限压缩并写入 JPEG Comment。

### 创建主图视频任务

```http
POST /api/ecommerce/video
Content-Type: application/json

{
  "images": [{ "data": "<base64>", "mimeType": "image/png" }],
  "brief": { "title": "白色保温杯", "category": "家居 / 水杯" },
  "ratio": "9:16",
  "duration": 15,
  "prompt": "暖光，缓慢推近",
  "transition": "fade",
  "bgm": { "data": "<base64>", "mimeType": "audio/mpeg" },
  "subtitles": ["24 小时保温", "轻量便携设计"],
  "providerId": "kunrou",
  "modelId": "seedance-2.5",
  "aiLabel": true
}
```

返回 `202 { id, status: "queued" }`。`duration` 仅支持 5 / 10 / 15；`transition` 为 `none | fade | slide`；`subtitles` 最多 3 条、每条 60 字；`bgm` 可选，服务端循环并压低音量；`aiLabel` 默认 `true`，会在左下角烧录「AI 生成」并写入 MP4 `comment`。

### 创建详情页任务

```http
POST /api/ecommerce/detail
Content-Type: application/json

{
  "images": [{ "data": "<base64>", "mimeType": "image/png" }],
  "brief": { "title": "白色保温杯", "category": "家居 / 水杯", "sellingPoints": ["24 小时保温", "轻量便携"] },
  "width": 750,
  "style": "white",
  "providerId": "kunrou",
  "modelId": "gemini-3.1-flash-image"
}
```

`style` 为 `scene | white`；`width` 仅支持 750 / 800；`style=white` 时忽略模型参数。

### 创建口播任务

```http
POST /api/ecommerce/talk
Content-Type: application/json

{
  "images": [{ "data": "<base64>", "mimeType": "image/png" }],
  "script": "这款保温杯采用双层真空结构，24 小时锁温。",
  "ratio": "9:16",
  "voice": { "providerId": "kunrouAudio", "modelId": "gemini-3.8-flash-tts", "voice": "Zephyr" },
  "subtitles": true,
  "aiLabel": true
}
```

`script` 上限 2000 字；`voice` 省略时使用第一个可用语音模型；`subtitles` 默认开启；`aiLabel` 默认开启，静态口播与数字人成片都会烧录标识。

### 创建批量任务

```http
POST /api/ecommerce/batch
Content-Type: application/json

{
  "csv": "title,category,sellingPoints\n白色保温杯,家居,24小时保温|轻量便携",
  "style": "white",
  "sharedImage": { "data": "<base64>", "mimeType": "image/png" },
  "scenePrompt": "浅木色桌面",
  "providerId": "kunrou",
  "modelId": "gemini-3.1-flash-image",
  "targets": [
    { "ratio": "1:1", "width": 1200, "height": 1200 },
    { "ratio": "9:16", "width": 1080, "height": 1920 }
  ]
}
```

`csv` 上限 20000 字符、最多 20 行；`style` 为 `white | scene`；`sharedImage` 可选；`targets` 最多 4 项，仅接受上表中的规格，未匹配的尺寸会被忽略，不传时默认 1:1 1200。

批量视频把 `targets` 换成 `video`：

```json
{
  "csv": "title,category,sellingPoints\n白色保温杯,家居,24小时保温|轻量便携",
  "sharedImage": { "data": "<base64>", "mimeType": "image/png" },
  "providerId": "kunrou",
  "modelId": "seedance-2.5",
  "video": {
    "ratio": "9:16",
    "duration": 10,
    "transition": "fade",
    "subtitles": true,
    "bgm": { "data": "<base64>", "mimeType": "audio/mpeg" }
  }
}
```

`video.subtitles` 默认 `true`，用每行卖点作为字幕；`bgm` 可选，整批复用。

### 批量历史

```http
GET /api/ecommerce/batchHistory?page=1&pageSize=10
```

返回 `{ items, total, page, pageSize }`，每项含 `mode / style / sizes / total / succeeded / failed / zipUrl / canResume / legacy`。

### 批量行明细

```http
GET /api/ecommerce/batchItems?id=<taskId>
```

返回 `{ task, items[] }`，每行为 `{ index, title, status, error, files[] }`，`files` 是 `{ width, height, path }`，`path` 为 ZIP 内相对路径。

### 断点续跑

```http
POST /api/ecommerce/batchResume
Content-Type: application/json

{ "id": "<taskId>", "rows": [2, 5] }
```

`rows` 省略时自动重跑所有非 `succeeded` 的行。返回 `202 { id, status: "queued", rows }`；没有可续跑的行返回 400，任务正在执行返回 409。续跑沿用原任务的 CSV、风格、尺寸、视频参数、共享商品图与 BGM。

### 取消与删除

```http
POST /api/ecommerce/cancel
POST /api/ecommerce/remove
Content-Type: application/json

{ "id": "<taskId>" }
```

`cancel` 对排队/执行中的任务生效，状态置为 `failed`、错误为「任务已取消」；`remove` 只允许删除已结束的任务，同时清理数据库与产物目录。成员只能操作自己的任务，管理员可操作全部。

### 抠图连通性测试

```http
POST /api/ecommerce/testMatting
```

仅管理员可用。用一张 256×256 纯色图真实调用一次抠图服务，返回 `{ provider, latencyMs, bytes }`；未配置 Key 返回 400。**会消耗 1 次抠图额度。**

### 查询任务

```http
GET /api/ecommerce/status?id=<taskId>
```

成员只能查询自己的任务；管理员可查询全部。任务正在执行时 `warnings` 会包含「进度 x/y」，可用于轮询展示。
`status`：`queued | running | succeeded | partial | failed`；`outputs[]` 含 `label / width / height / path / url`；`warnings[]` 记录降级原因与场景模型。

### 任务列表

```http
GET /api/ecommerce/list
```

最近 20 条。

### 读取产物

```http
GET /api/ecommerce/assets/<taskId>/<fileName>
```

需登录，返回图片二进制，可直接用于 `<img src>`。

## 数据位置

| 路径 | 内容 |
| --- | --- |
| `data/ecommerce/<taskId>/input.*` | 上传的商品原图 |
| `data/ecommerce/<taskId>/cutout.png` | 抠图结果（透明 PNG） |
| `data/ecommerce/<taskId>/scenes/` | 模型生成的空镜背景 |
| `data/ecommerce/<taskId>/final-<w>x<h>.jpg` | 合成后的成品（JPEG，已按平台上限压缩） |
| `data/ecommerce/<taskId>/segments/` | 视频分段原片 |
| `data/ecommerce/<taskId>/video-<w>x<h>.mp4` | 拼接后的主图视频 |
| `data/ecommerce/<taskId>/module-*.png` | 详情页每一屏 |
| `data/ecommerce/<taskId>/detail-<width>.jpg` | 拼好的详情页长图 |
| `data/ecommerce/<taskId>/voice/` | 口播语音 |
| `data/ecommerce/<taskId>/talk-<w>x<h>.mp4` | 口播成片 |
| `data/ecommerce/<taskId>/batch-<n>.zip` | 批量套图压缩包（按 SKU 分目录） |
| `data/ecommerce/<taskId>/request.json` | 批量任务的原始 CSV、风格、尺寸、模型 |
| `data/ecommerce/<taskId>/shared-input.*` | 批量任务上传的共享商品图 |
| `data/ecommerce/<taskId>/batch-bgm.*` | 批量视频使用的背景音乐 |
| `data/ecommerce/<taskId>/item-<seq>/` | 批量每行的中间文件与成品 |
| `data/system.db` 的 `ecommerce_tasks` 表 | 任务状态、产物清单、警告信息 |
| `data/system.db` 的 `ecommerce_batch_items` 表 | 批量每行的状态、错误、产物路径 |

清理旧任务可直接删除对应任务目录；`ecommerce_tasks` 中的记录不会自动删除，便于追溯。

## 已知边界

- P1 只支持单张商品图；多图套装（正面/侧面/细节）在后续版本扩展。
- 主图视频为 5 秒分段拼接，转场固定 0.6 秒；不支持单段 15 秒以上的连续运镜。
- BGM 仅支持上传，暂不内置音乐库；字幕固定为白字 + 半透明底，暂不支持自定义字体与样式。
- 字幕依赖系统中文字体（Windows 微软雅黑 / macOS 苹方 / Linux Noto CJK），缺失时会跳过并给出警告。
- 详情页为固定版式（首屏 / 卖点 / 收尾），暂不支持自定义模块顺序与配色；卖点最多 4 条。
- 口播没有唇形同步，属于静态人物 + 语音 + 字幕；字幕按标点均分时间，语速差异较大时可能需要手动调整文案断句。
- 数字人适配器只内置 D-ID 与通用自定义协议；HeyGen 需要先创建 talking photo，暂未适配。
- 批量任务串行执行，20 行场景模式会调用 20 次图片模型（与勾选几个尺寸无关），建议先用白底模式校验 CSV 与文件名映射。
- 批量视频同样串行：20 行 × 3 段 = 60 次视频模型调用，建议先用 1 行 5 秒试跑。
- 视频标识与字幕共用一次转码；未选择字幕时也会单独烧一次标识（多一次编码）。
- 「模特展示」配方为实验能力，生成的是带人物的场景，商品合成位置固定，需要人工筛选。
- 场景生成会真实调用所选图片模型并产生费用；白底配方完全本地处理，不产生模型费用。
- 降级模式仅为链路兜底，不建议用于正式上架素材。
