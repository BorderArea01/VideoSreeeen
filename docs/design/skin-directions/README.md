# 四版交互提案 · 待选择

本目录为独立的视觉 / 动效原型，不导入正式客户端，不连接房间、麦克风、视频源或账号服务。正式网页继续使用当前版本；选定方向后再进入正式实现。

打开 `index.html` 切换 A / B / C / D，或打开 `board.html` 并排比较。每版都能扫过背景、掠过卡片、悬停 / 点击按钮；「播放交互示范」会依次展示背景、整面容器材质与按钮动作。影片位置是 CSS 占位画面，成员和消息明确标记为演示数据；消息输入只留在当前页面。

四版均以强烈的横向破碎为前提；上一轮的玻璃、柔光与胶片方向已移除。

| 方案       | 背景                                       | 容器本体                                     | 按钮                            |
| ---------- | ------------------------------------------ | -------------------------------------------- | ------------------------------- |
| A 像素断流 | 天空照片被横向抽长，像素排序风格的细密断流 | 深蓝不等高切片，横向长尾、透明断口与离体碎块 | 13 层碎条交错拉伸，轻微青红偏移 |
| B 悬浮碎层 | 自然日光下的云层撕成长片，分层漂移         | 云白实体解体成悬浮水平薄片                   | 蓝白碎层上下错开再重组          |
| C 数据熔合 | 照片窄区反复拉长，模拟损坏帧拖影           | 墨蓝条带、青紫熔合残影和长尾                 | 拉伸黏连后重新收束              |
| D 错帧崩解 | 宽窄交错的断帧与脱离的图像块               | 成组横条大幅错层、参差断口                   | 碎层离轨、悬浮与错帧复位        |

容器不再有完整矩形底色：本体由 22–46 个不等高片段组成，透明切口穿过整面，能直接看到天空；按钮由 13 层组成。断层集中在几组位置，不使用等距百叶窗纹理或碎点外框。自然天空照片也有静态破损，缩放仍覆盖全屏；关闭动态后保留破碎造型。

背景使用事件留下的独立冲量：记录经过位置、进入速度和初始时刻，之后按自身生命周期演变，不每帧重置到鼠标位置。按钮与容器进入后按该次速度、方向与独立相位展开、漂散、复位；持续扫过可再次触发，静止时不无限闪动。datamoshing 为界面材质的视觉模拟，不处理或损坏影片帧。真实文字与点击区域保持独立，影片区域不切碎。

## 验证和资源

通过受控入口运行：

```powershell
& ./scripts/controlled.ps1 -File node.exe -Arguments @('scripts/skin-directions-check.mjs') -AllowGameThisRun -MinFreeMiB 0
```

脚本在 loopback 静态服务与隔离 Edge 内检查四版背景响应 / 衰减、容器中央的真实透明切口、无矩形底色、片段数量与动态、按钮反馈、320 / 390 / 1440 / 2000 像素布局、减少动态效果模式和演示输入。所有请求限制为同一预览站点，检查不访问真实房间。截图位于 `.local/screenshots/skin-*.png`，证据 `.local/skin-directions-evidence.json`；窄屏检查不代表手机真机验收。

预览不需要编译或新依赖。102,094 字节的 `sky.webp` 是内置 `image_gen` 生成的干净蓝天基底，仅转换为 WebP；原始 PNG 保留在本机生成素材目录。原来的故障背景资源和正式皮肤没有被覆盖。实际生成提示词如下：

```text
Use-case: photorealistic-natural. One clean cinematic photographic background asset, landscape 16:9. A clear bright blue daytime sky with natural white sunlit cumulus clouds, delicate soft cloud shadows, realistic atmospheric depth and fine cloud detail. Open blue space through the central area, cloud banks lower and near the lateral edges, sunlight coming from upper right. Premium natural daylight photography, subtly cinematic without dramatic grading. No glitch, no digital corruption, no grain, no RGB displacement, no particles, no graphic shapes, no text, no watermarks, no people, no buildings. This will be the quiet photographic foundation under four interactive website skin prototypes; their distortion and light effects are implemented in code.
```

预览只渲染当前方向；背景绘制限制约 140 万像素、DPR 1.2、交互期间约 30 FPS，冲量结束后停止逐帧更新。切换方向会取消上一版动画和示范计时器，减少动态效果或隐藏页面时停止动画。并排页的四个 iframe 默认静止，允许逐个体验。
