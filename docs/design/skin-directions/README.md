# 四版交互提案 · 待选择

本目录为独立的视觉 / 动效原型，不导入正式客户端，不连接房间、麦克风、视频源或账号服务。正式网页继续使用当前版本；选定方向后再进入正式实现。

打开 `index.html` 切换 A / B / C / D，或打开 `board.html` 并排比较。每版都能扫过背景、掠过卡片、悬停 / 点击按钮；「播放交互示范」会依次展示背景、整面容器材质与按钮动作。影片位置是 CSS 占位画面，成员和消息明确标记为演示数据；消息输入只留在当前页面。

四版统一保留完整主体与清晰文字，破碎仅发生在按钮和容器外围约 15% 的带状区域。

| 方案       | 背景             | 容器边缘                       | 按钮边缘               |
| ---------- | ---------------- | ------------------------------ | ---------------------- |
| A 像素断流 | 细密横向像素拉伸 | 深蓝切片、透明断口、少量离体块 | 细碎横条，轻微青红偏移 |
| B 悬浮碎层 | 云层长片分层漂移 | 云白薄片悬浮                   | 白蓝边缘错层重组       |
| C 数据熔合 | 损坏帧拖影风格   | 青紫熔合残影与拉伸长尾         | 边缘拉长、黏连后收束   |
| D 错帧崩解 | 宽窄交错的断帧   | 边缘成组错位、参差断口         | 少量碎层离轨后复位     |

主体是连续实色面：约 85% 的主体面积完全不参与撕裂、抽长、透明切口或 RGB 偏移；外围环形带约占总面积 15%，按容器长宽计算统一厚度，避免把“每边 15%”误算成切掉半个容器。靠近边缘的文字另有完整底色保护，真实文字、点击区域与整体轮廓保持清晰。漂浮碎片可以向外脱离，但不能穿过正文。影片画面保持完整。

背景使用经过位置留下的独立冲量，记录速度与时刻后自行演变，不粘着指针。边缘动效根据该次方向、速度与独立相位展开后收束；静止时不无限闪动。关闭动态后保留静态破碎轮廓。datamoshing 是装饰材质的视觉模拟，不处理影片帧。

## 验证和资源

通过受控入口运行：

```powershell
& ./scripts/controlled.ps1 -File node.exe -Arguments @('scripts/skin-directions-check.mjs') -AllowGameThisRun -MinFreeMiB 0
```

脚本在 loopback 静态服务与隔离 Edge 内检查四版背景响应 / 衰减、容器中心完整不透明、真实边缘切口、边缘片段动态、按钮反馈、320 / 390 / 1440 / 2000 像素布局、减少动态效果模式和演示输入。所有请求限制为同一预览站点，检查不访问真实房间。截图位于 `.local/screenshots/skin-*.png`，证据 `.local/skin-directions-evidence.json`；窄屏检查不代表手机真机验收。

预览不需要编译或新依赖。102,094 字节的 `sky.webp` 是内置 `image_gen` 生成的干净蓝天基底，仅转换为 WebP；原始 PNG 保留在本机生成素材目录。原来的故障背景资源和正式皮肤没有被覆盖。实际生成提示词如下：

```text
Use-case: photorealistic-natural. One clean cinematic photographic background asset, landscape 16:9. A clear bright blue daytime sky with natural white sunlit cumulus clouds, delicate soft cloud shadows, realistic atmospheric depth and fine cloud detail. Open blue space through the central area, cloud banks lower and near the lateral edges, sunlight coming from upper right. Premium natural daylight photography, subtly cinematic without dramatic grading. No glitch, no digital corruption, no grain, no RGB displacement, no particles, no graphic shapes, no text, no watermarks, no people, no buildings. This will be the quiet photographic foundation under four interactive website skin prototypes; their distortion and light effects are implemented in code.
```

预览只渲染当前方向；背景绘制限制约 140 万像素、DPR 1.2、交互期间约 30 FPS，冲量结束后停止逐帧更新。切换方向会取消上一版动画和示范计时器，减少动态效果或隐藏页面时停止动画。并排页的四个 iframe 默认静止，允许逐个体验。
