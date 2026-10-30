# 四版交互提案 · 待选择

本目录为独立的视觉 / 动效原型，不导入正式客户端，不连接房间、麦克风、视频源或账号服务。正式网页继续使用当前版本；选定方向后再进入正式实现。

打开 `index.html` 切换 A / B / C / D，或打开 `board.html` 并排比较。每版都能扫过背景、掠过卡片、悬停 / 点击按钮；「播放交互示范」会依次展示背景、整面容器材质与按钮动作。影片位置是 CSS 占位画面，成员和消息明确标记为演示数据；消息输入只留在当前页面。

四版均来自用户选择的原 B 版（浅色悬浮碎层），统一为容器材质 90% 不透明（透出 10% 背景），文字与按钮不整体降低透明度。外围效果带从总面积 15% 收窄到约 8%，主体约 92% 连续完整；离体碎片数量、飞出距离和动态幅度同步收敛。

| 方案        | 色调            | 边缘变化           | 动态节奏           |
| ----------- | --------------- | ------------------ | ------------------ |
| B1 云隙细切 | 原 B 云白与晴蓝 | 细密、较短的横切   | 快速展开、短促收束 |
| B2 浮云叠片 | 日光云白        | 较宽薄片，三层一组 | 延迟浮起、舒展回落 |
| B3 冰蓝拖影 | 清冷冰蓝        | 纤细的拉伸熔合尾迹 | 拉长后缓慢回收     |
| B4 晴空散页 | 淡紫云白        | 稀疏、成组错层     | 小组上浮、各自归位 |

四版使用不同固定随机种子生成切片位置与高度，使比较时结构稳定；每次交互保留独立相位与方向变化。内部 hash A / B / C / D 分别对应 B1 / B2 / B3 / B4。

视频及周边至少 12px 为装饰禁入区：各卡片与按钮的装饰画布在这里清空，背景撕裂也绕开该区域，播放器另有独立叠放层。限制不依赖卡片在 DOM 中的先后关系。容器透明只作用于材质画布，不降低文字、图标或控制按钮的可读性。完整主体、边缘文字底色保护、稳定点击区域继续保留。

背景保留经过位置的独立冲量，不粘着鼠标；动画收束后停止绘制。减少动态效果模式保留静态边缘造型。datamoshing 仅为边缘材质的视觉模拟，不改变影片帧。本目录仍为隔离预览，用户选定后再接入正式版本。

## 验证和资源

通过受控入口运行：

```powershell
& ./scripts/controlled.ps1 -File node.exe -Arguments @('scripts/skin-directions-check.mjs') -AllowGameThisRun -MinFreeMiB 0
```

脚本在 loopback 静态服务与隔离 Edge 内检查四版背景响应 / 衰减、容器材质90%不透明、中心完整、约8%边缘切口、视频禁入区、边缘片段动态、按钮反馈、320 / 390 / 1440 / 2000 像素布局、减少动态效果模式和演示输入。所有请求限制为同一预览站点，检查不访问真实房间。截图位于 `.local/screenshots/skin-*.png`，证据 `.local/skin-directions-evidence.json`；窄屏检查不代表手机真机验收。

预览不需要编译或新依赖。102,094 字节的 `sky.webp` 是内置 `image_gen` 生成的干净蓝天基底，仅转换为 WebP；原始 PNG 保留在本机生成素材目录。原来的故障背景资源和正式皮肤没有被覆盖。实际生成提示词如下：

```text
Use-case: photorealistic-natural. One clean cinematic photographic background asset, landscape 16:9. A clear bright blue daytime sky with natural white sunlit cumulus clouds, delicate soft cloud shadows, realistic atmospheric depth and fine cloud detail. Open blue space through the central area, cloud banks lower and near the lateral edges, sunlight coming from upper right. Premium natural daylight photography, subtly cinematic without dramatic grading. No glitch, no digital corruption, no grain, no RGB displacement, no particles, no graphic shapes, no text, no watermarks, no people, no buildings. This will be the quiet photographic foundation under four interactive website skin prototypes; their distortion and light effects are implemented in code.
```

预览只渲染当前方向；背景绘制限制约 140 万像素、DPR 1.2、交互期间约 30 FPS，冲量结束后停止逐帧更新。切换方向会取消上一版动画和示范计时器，减少动态效果或隐藏页面时停止动画。并排页的四个 iframe 默认静止，允许逐个体验。
