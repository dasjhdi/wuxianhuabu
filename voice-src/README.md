# 角色音色素材目录

把每个角色的参考音频放在本目录，然后运行一次导入命令，即可在画布里按「音色 ID」使用。

## 文件命名规则

同一个音色由 **同名** 的音频与文本成对组成：

```
voice-src/
    lingqingyan.wav      # 参考音频
    lingqingyan.txt      # 与音频逐字一致的文本（含标点）
    lingqingyan.json     # 可选，显示名与备注
    suwan.wav
    suwan.txt
```

- 音色 ID 就是文件名（`lingqingyan`），支持中文，如 `凌清砚.wav` + `凌清砚.txt`
- 支持的音频格式：`.wav` `.mp3` `.m4a` `.flac` `.ogg`
- `.json` 可选，内容示例：

```json
{"name":"凌清砚","description":"低沉清冷，语速偏慢"}
```

## 音频要求

| 项 | 要求 |
|---|---|
| 时长 | 10–30 秒（少于 3 秒会被拒绝） |
| 内容 | 单人说话，**不要**背景音乐、混响、多人对话 |
| 质量 | 无爆音、无电流声；手机近距离录音通常可用 |
| 文本 | 必须与音频**逐字一致**，包括标点；差一个字都会影响克隆相似度 |

## 导入命令

```bat
cd /d D:\wuxianhuabu\CosyVoice
.venv\Scripts\python.exe import_voices.py D:\wuxianhuabu\voice-src
```

成功后可用 `curl http://127.0.0.1:8100/voices` 查看已注册音色。

## 已注册音色

| 音色 ID | 名称 | 备注 |
|---|---|---|
| `demo_nv` | 测试女声 | 系统自带，用于流程验证，可随时删除 |
