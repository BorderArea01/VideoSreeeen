# 四版交互提案 · 待选择

本目录为独立的视觉 / 动效原型，不导入正式客户端，不连接房间、麦克风、视频源或账号服务。正式网页继续使用当前版本；选定方向后再进入正式实现。

打开 `index.html` 切换 A / B / C / D，或打开 `board.html` 并排比较。每版都能扫过背景、掠过卡片、悬停 / 点击按钮；「播放交互示范」会依次展示背景、整面容器材质与按钮动作。影片位置是 CSS 占位画面，成员和消息明确标记为演示数据；消息输入只留在当前页面。

| 方案         | 背景响应                               | 容器材质                     | 按钮反馈                         | 方向                     |
| ------------ | -------------------------------------- | ---------------------------- | -------------------------------- | ------------------------ |
| A 晴空断层   | 留在经过处的宽幅错位，展开后衰减       | 深蓝半透明整面光带与阴影过渡 | 按进入方向、速度短促错位并复位   | 保留故障感，平衡使用     |
| B 云层浮玻璃 | 有惯性的云层位移，柔和折射在经过处扩散 | 浅色厚玻璃、整面柔光与透景   | 光从进入处铺开，柔软按压回弹     | 轻盈舒适，推荐长时间观看 |
| C 胶片回声   | 延迟的宽幅追踪带与曝光余韵             | 深色哑光、暖曝光与缓慢残影   | 短按压与长余光，略有延迟         | 安静的电影感             |
| D 棱镜折面   | 固定空间中的大块折面依次响应           | 几何层叠、斜向折光和整体阴影 | 三块宽条表面错开后合拢，文字完整 | 更鲜明的数字 / 空间感    |

背景使用事件留下的独立冲量：记录经过位置、进入速度和初始时刻，之后按自身生命周期演变；旧波形不会每帧重置到鼠标位置。容器作用于整面材质与光影，不绘制碎点边框；按钮动作不使用永久循环，通过进入方向、速度、弹性状态与点击触发。各方向可以混搭选型，例如 A 背景、B 容器、D 按钮。

## 验证和资源

通过受控入口运行：

```powershell
& ./scripts/controlled.ps1 -File node.exe -Arguments @('scripts/skin-directions-check.mjs') -AllowGameThisRun -MinFreeMiB 0
```

脚本在 loopback 静态服务与隔离 Edge 内检查四版背景响应 / 衰减、整面材质动画、按钮反馈、320 / 390 / 1440 / 2000 像素布局、减少动态效果模式和演示输入。所有请求限制为同一预览站点，检查不访问真实房间。截图位于 `.local/screenshots/skin-*.png`，证据 `.local/skin-directions-evidence.json`；窄屏检查不代表手机真机验收。

预览不需要编译或新依赖。102,094 字节的 `sky.webp` 是内置 `image_gen` 生成的干净蓝天基底，仅转换为 WebP；原始 PNG 保留在本机生成素材目录。原来的故障背景资源和正式皮肤没有被覆盖。实际生成提示词如下：

```text
Use-case: photorealistic-natural. One clean cinematic photographic background asset, landscape 16:9. A clear bright blue daytime sky with natural white sunlit cumulus clouds, delicate soft cloud shadows, realistic atmospheric depth and fine cloud detail. Open blue space through the central area, cloud banks lower and near the lateral edges, sunlight coming from upper right. Premium natural daylight photography, subtly cinematic without dramatic grading. No glitch, no digital corruption, no grain, no RGB displacement, no particles, no graphic shapes, no text, no watermarks, no people, no buildings. This will be the quiet photographic foundation under four interactive website skin prototypes; their distortion and light effects are implemented in code.
```

预览只渲染当前方向；背景绘制限制约 140 万像素、DPR 1.2、交互期间约 30 FPS，冲量结束后停止逐帧更新。切换方向会取消上一版动画和示范计时器，减少动态效果或隐藏页面时停止动画。并排页的四个 iframe 默认静止，允许逐个体验。
