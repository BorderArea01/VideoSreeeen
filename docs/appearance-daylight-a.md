# A · 天光断层（Daylight Rupture）

2026-10-31，按用户选择，将[四版概念中的 A](design/glitch-concepts/01-daylight-rupture.png)落到真实观影页面。概念图仅作配色、材质和构图参考，未将其中的界面、影片或文字铺成背景。

## 实际界面

![A 版真实双端房间截图，示例影片为 MDN CC0 MP4](screenshots/glitch-art.png)

独立预览：<https://daylight-a.videosreeeen.pages.dev/?skin=glitch>。正式入口保持当前版；本次不发布 Windows / Android 安装包，不更新房间 Worker。

在顶部调色盘或「设置与帮助 → 界面皮肤」选择「天光断层 · Glitch Art」。仍保留「暖夜 · 原版」、首次随机分配、同标签页刷新保持和手动选择记忆。`?skin=glitch` 是只影响本机的外观选择链接：记住选择后移除此参数，保留邀请 hash，不写房间状态。

## 设计与边界

- 逐项对照用户再次提供的 A 图：左侧大字品牌、右上「01 / DAYLIGHT RUPTURE」、204px 标题区、影片 / 聊天等高双栏、贯穿底部的播放方式与链接操作带。晴昼云海、下方海岛与右下白色建筑，瓷白面板、钴蓝按钮、深蓝文字均来自同一参考方向。
- 语音收进底栏的可展开入口，真实成员与 RTT 收进「成员与连接」，共同缓存仍仅在共同播放分支显示。所有入口搬动的都是原有 DOM 控件，换回暖夜和进入全屏时恢复原位置，不创建假控件或新播放器。聊天室保留真实昵称 / 时间，圆形头像使用发送者昵称首字符，不伪造人物照片。
- 卡片保留完整正文区域，损坏集中于材质外沿：不等距的横向断层、照片条带、白 / 蓝材质碎片和少量色偏像素。按钮文字与实际点击控件保留，不克隆一套假控件，不给边框铺均匀碎点。
- 鼠标经过产生各自保留起点的短暂余像，随时间向外散开，约 1.1 秒收束。最多 8 组余像，不持续跟随鼠标坐标，不运行闲置动画。触屏和系统「减少动态效果」保留静态材质。
- 背景与碎片为两张独立、不接收输入的 Canvas；只采样本主题照片，不采样电影、第三方页面或聊天内容。不发送鼠标坐标，不引入动画库。
- 每帧清除视频、控制栏、输入框与文字操作区的装饰，避免邻接碎片遮挡；系统 / 网页全屏暂停并隐藏画布。真实播放器保持完整，不对片源添加特效，不因为换肤重载、暂停或提交同步操作。参考图的海岸影片不属于主题；实际影片按原始比例居中显示，宽银幕外框在遇到较窄片源时保留黑边。
- Canvas 上限 240 万像素、DPR 1.5、交互上限 30 fps；没有余像且面板位置未变时不重复绘制。切回原版释放三张画布 backing store。隐藏页面停止帧循环，强制颜色模式隐藏装饰。
- 聊天仍固定高度、内部滚动、可拖拽停靠；缓存仍为共同播放下默认关闭的手动选项。样式未改变房间、视频解析、缓存和语音协议。

## 素材

背景使用内置 `image_gen`，将用户再次提供的 A 图作为编辑目标，移除全部界面、文字、聊天室和独立海岸电影窗口，保留外围云层、下方海岛及白色建筑，并补全中心天空。原始 PNG 保留在 Codex 生成目录，浏览器 Canvas 仅转为 WebP，项目文件 `client/assets/themes/daylight-sky.webp`（318,344 字节）。此前另行生成的泛用天空底图已从运行时资产中替换，没有叠加旧界面截图。

生成提示词：

```text
Edit target: the attached DAYLIGHT RUPTURE reference screenshot. Create the production BACKGROUND PLATE for implementing this exact website, not another design proposal. Remove EVERY interface element: the VideoSreeeen logo, Chinese text, 01, DAYLIGHT RUPTURE typography, central rectangular movie window and its entirely separate cliff movie picture, the chat card and all avatar/message contents, the bottom toolbar, all buttons and controls. Seamlessly inpaint those removed areas with the surrounding photographic sky landscape. PRESERVE the original background composition as faithfully as possible: brilliant cobalt blue upper-right sky, enormous densely detailed sunlit white clouds along the top-left and framing the left, center lower clouds with a distant blue Mediterranean island horizon ONLY along the bottom fifth, the photorealistic white hillside buildings and rocky sea coast at the very bottom-right. Preserve the natural photographic day lighting and original cloud shapes around the outer edges. Preserve horizontal pixel-sorting tears and data-moshed photographic cloud / blue / white streaks near the upper-middle, left and right peripheral edges and lower edges, with sparse tiny RGB misregistrations. Keep the wide central area reasonably quiet behind future functional panels. The finished plate must be one seamless edge-to-edge photographic background only, with ZERO remaining rectangular UI panel silhouettes, ZERO text, ZERO logos, ZERO buttons, ZERO player/film window, ZERO people. Match the reference's 3:2 landscape framing and high photographic detail. Do not replace it with a generic all-sky cloud photo.
```

## 验证方法

所有构建与验收串行经过 `scripts/controlled.ps1 -AllowGameThisRun -MinFreeMiB 0`，未触发客户端发布工作流，不接触用户正在观看的房间或真实设备。

- `npm run build`：类型检查、Vite 前端与现有服务端 / 助手构建。助手内容和 ZIP 校验保持原样，没有发布新版助手。
- `npm run test:appearance`：独立 Edge、真实双端房间、实际 WebSocket、MDN CC0 MP4；检查皮肤分配与记忆、播放中换肤保持同一 video / 地址 / 进度、不出现 loadstart / 暂停 / 房间控制、另一端独立外观、真实双向文字聊天、拖拽与停靠。
- 动态检查使用真实装饰画布像素变化与停止，检查按钮和容器的有限余像、视频区域透明、鼠标穿透、减少动态效果、强制颜色、网页全屏。2560×1440、800×1100、1.5 倍 visual viewport、390 / 320px 布局与截图核对；这不是手机真机结论。
- `npm run test:player-controls`：实际播放、暂停、跳转、进度预览、精细定位、HLS 预览、网页 / 系统全屏与闲置隐藏回归。普通单元测试另行运行。
- 公网使用独立预览地址和新房间验证，同一个房间 Worker；受控视频 fixture 不等于 B 站 / 稀饭全线路验收，不访问麦克风，不代表语音采集实测。

本机证据 `.local/appearance-evidence.json`、`.local/appearance-public-evidence.json`、`.local/screenshots/theme-*.png`；部署与最终检查结果见下方回执。

参考：[Canvas 绘制与状态](https://html.spec.whatwg.org/dev/canvas.html)、[ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API)、[减少动态效果](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)。

## 验收回执

- 源码提交 `8c4f8c0`；2026-10-31 已部署到独立 Pages 预览 `ab7dacdf`，固定地址 <https://ab7dacdf.videosreeeen.pages.dev/?skin=glitch>，别名 <https://daylight-a.videosreeeen.pages.dev/?skin=glitch>。仅此预览更新，正式入口未切换。
- 最终构建通过，116 项单元测试通过；本地与公网 `test:appearance` 均通过。真实两端 MP4 播放、双向文字聊天、拖拽 / 停靠、外观选择与记忆正常；换肤保持同一 video、0 次 loadstart、无暂停和房间控制。语音已加入收听后跨皮肤切换保持同一面板与连接，未开启物理麦克风。
- 1536×1024 的实际布局：播放器 `(79.86, 204)`，`968.77×503.75`；聊天室 `(1068.63, 204)`，`387.52×503.75`；底栏 `(79.86, 727.75)`，`1376.28×96`。截图为真实房间与示例视频，不将概念稿充作运行画面。
- A 皮肤下 `VS_TEST_SKIN=glitch npm run test:player-controls` 通过：实际 MP4 / HLS 预览、暂停、跳转、精细定位、网页 / 系统全屏、约 1 秒闲置隐藏、窄屏与触摸仿真。错误列表为空；不代表手机真机验收。
- 动效实录 `.local/daylight-motion.webm`，5.45 秒、1152×768、517,358 字节：从独立浏览器的真实页面捕获，不是概念图动画或电影录屏。仅含本机合成房间、CC0 示例视频和鼠标引发的材质动效，没有用户房间或账号。
- 核对预览 HTML、6 个 JS / CSS / WebP 资源和预览别名，均与本地成品逐字节一致。入口 `index-CKShY03F.js` SHA-256 `8614eaef15847dae4dd295304b09bfe4566ea97bfa3fdcfaffe9f106c5fa18c4`；CSS `index-89MxgkNv.css` SHA-256 `e6083501d7b3313738980a0529db364cbc47774c409ea09096ac3cad48b69775`；背景 SHA-256 `c074b0268270f486e5e6215a4721e242e62b79f98a5c2673c5fe2a1f9acde887`。本机回执 `.local/daylight-public-assets.json`。
- 正式入口仍加载 `assets/index-ByAASs3a.js`，核对未改变；房间 Worker、Durable Objects、原站取源和已发布客户端未更新。没有创建新付费资源，没有启用 TURN，没有新增安装包、Release、标签或回退版本。当前 dist 约 1.18 MiB，Pages 上传目录约 1.19 MiB，仍沿用 `.local/rollback/manifest.json` 定位的唯一回退。
