# A · 天光断层（Daylight Rupture）

2026-10-31，按用户提供的[参考 A 图](design/glitch-concepts/01-daylight-rupture.png)实现真实观影界面，并根据反馈重做边缘材质。保留大片、密集、交错的深蓝 / 白色照片条块，将断层绑定到真实容器和按钮边缘，鼠标扫过时分层伸展、错位、回落。

## 实际界面

![A 版真实双端房间截图，示例影片为 MDN CC0 MP4](screenshots/glitch-art.png)

独立预览：<https://daylight-a.videosreeeen.pages.dev/?skin=glitch>。正式入口保持当前版；本次不发布 Windows / Android 安装包，不更新房间 Worker。

顶部调色盘或「设置与帮助 → 界面皮肤」可选择「天光断层 · Glitch Art」。保留「暖夜 · 原版」、首次随机分配、同标签页刷新保持、手动选择记忆。`?skin=glitch` 只选择本机外观，记住后移除参数、保留邀请 hash，不写房间状态。

## 本轮调整

- 背景重新编辑为没有固定断层的自然天空。原生 1536×1024 PNG 直接作为全窗口 fixed / cover 图片展示，取消此前有损 WebP 转换和背景 Canvas 降采样；它不是 4K 图片，超大屏仍有原始分辨率边界。
- 删除右上「01 / DAYLIGHT RUPTURE」，品牌使用深蓝文字、浅色渐变衬底，提高天空和云层上的辨识度。
- 断层使用独立 RGBA 照片材质：真实云层纹理、深蓝厚块、白色横片、蓝色像素排序及少量 RGB 碎片。透明空隙保留，不把整张材质背景贴在页面上。
- 每个可见卡片 / 按钮读取自己的当前边界，按不同裁切位置取材。卡片破损只进入侧边最多 16% / 64px，按钮最多 16% / 25px，主要横向向外延伸；宽底栏左下缘也有相接断层。条块根部按组错开，避免笔直的贴纸接缝。折叠的缓存摘要不生成宽大断层。
- 鼠标扫过真实控件，纹理条带以成组切片伸展并回落，根部保持连接；动效约 1.1 秒收束，最多 8 个交互记录，停止后不运行闲置动画。背景响应仍采样本主题照片，余像独立离开鼠标，不持续黏着指针。触屏及系统「减少动态效果」保留静态材质。
- 装饰每帧避开影片、控制栏、输入框、聊天气泡、消息信息、语音入口和按钮文字。绘制不读取影片或聊天内容的像素，不改变实际命中区域；拖拽聊天室后边缘跟随，旧位置清空。
- 主背景是图片；背景余像、边缘材质分别使用透明 Canvas，另有仅供采样的离屏天空。每张 Canvas 上限 420 万像素、DPR 2、交互上限约 30 fps。仅在交互或布局变动时绘制。切回原版释放 backing store；隐藏页面、系统 / 网页全屏暂停，退出全屏恢复图片和画布。
- 保留原有双栏和整条操作带，语音、成员、缓存使用原有 DOM 控件，不创建假播放器。聊天固定高度、内部滚动、可拖拽停靠；换肤不重载视频、不发送播放控制。房间、取源、语音和缓存协议均未修改。

## 素材与生成记录

使用内置 `image_gen` 编辑模式。原始输出保留在 Codex 生成目录，最终运行素材复制到仓库：

| 素材         | 项目路径                                     | 原生尺寸  |      字节 |
| ------------ | -------------------------------------------- | --------- | --------: |
| 纯净天空照片 | `client/assets/themes/daylight-sky.png`      | 1536×1024 | 2,403,754 |
| 透明照片断层 | `client/assets/themes/daylight-fracture.png` | 1024×1536 | 2,195,990 |

背景以此前从 A 图去掉全部 UI 的照片为编辑目标；断层以原有照片损坏区为参考，之后单独提取透明背景。未对电影或网页截图进行生成式替换。两张最终 PNG 合计约 4.39 MiB，比旧压缩底图大，换取直接照片展示与独立材质。

纯净天空提示词：

```text
Edit this existing production photographic background. Preserve its exact photographic composition: sunlit cumulus clouds in the upper-left, rich blue clear upper-right sky, lower framing clouds, blue Mediterranean island and sea along the bottom fifth, white seaside buildings bottom-right. REMOVE ALL of the baked-in digital corruption, rectangular streaks, horizontal pixel sorting, dark horizontal slabs, tiny colored blocks, scanline glitches and RGB offsets from the ENTIRE image, especially the dark strip clusters down the RIGHT EDGE and bottom-left. Reconstruct clean natural cloud detail and blue sky in those places. The finished plate must be a pristine sharp realistic daylight photographic panorama with no glitch marks at all; the application will generate the glitch dynamically from actual panel edges. Improve optical clarity and realistic fine cloud texture: crisp natural cloud edges, well-defined sea coastline and white architecture, no soft wash, no blur, no over-smoothed texture, no painterly appearance. Render at the highest native detail and resolution available, preferably 3072x2048 or larger, landscape 3:2. No text, logo, UI, frame, panel, typography, fake button, or inserted movie scene. Preserve original framing, lighting and natural colors.
```

边缘材质提示词：

```text
Edit the reference's existing dense horizontal datamosh cloud corruption into a TRANSPARENT production UI EDGE TEXTURE. Preserve the EXACT reference material and impact, especially the broad dark navy / charcoal slabs mixed with cobalt sky, luminous white photographic cloud texture, cyan and a few tiny red misregistration slivers at the right edge and lower-left. Output a tall portrait texture atlas, transparent background. It is a SINGLE broken vertical material edge: a narrow continuous porcelain-white root down the LEFTMOST 8% of the sheet, then a strongly torn transition that erupts HORIZONTALLY RIGHT into very dense, overlapping, irregular-length large blocks and fine nested stripes. Root all major masses in that left edge. The fracture should occupy a wide deep swath, with varying penetration and huge irregular clusters, NOT three evenly spaced tufts, NOT a comb of isolated thin lines, NOT tiny sparse border confetti. Use the reference's photographic pixel-sorted cloud and blue material, chunky dark underplates, stacked wide offset segments, irregular gaps and a scattering of detached tiny scraps toward the far-right. Leave the rightmost 15% mostly transparent. No scene/background rectangle: transparent gaps throughout the torn zone, preserving original genuine alpha. No lettering, logo, UI mockup, button, complete box, contour outline, grid, glow, smoke, people, or added objects. Keep rich natural photo material in the strips instead of drawing flat geometric blue bars. This asset will be attached to real container borders and animated in layered slices. The desired impact and density must remain as strong as the original reference's dense corrupted edges.
```

透明提取修订提示词：

```text
Use case: background-extraction. Edit target: the provided tall broken cloud/blue pixel-sorting material. Remove ONLY the smooth blue/black gradient backdrop behind the horizontal torn slabs. Replace that entire smooth background with genuine transparent alpha, including the large gaps between the stripes and the right edge. Keep the photographic cloud fragments, dense dark navy slabs, white root along left, cobalt horizontal strips and tiny RGB slivers. Preserve their sharp edges and internal textures. This is a cutout production border texture, no rectangular backdrop, no checkerboard drawn into pixels, no glow/fog or new scene. Preserve the irregular dense large overlapping horizontal fragments and left root. Actual RGBA transparency is mandatory.
```

## 验证方法

构建、测试、录制和部署串行经过 `scripts/controlled.ps1 -AllowGameThisRun -MinFreeMiB 0`，只使用隔离浏览器与独立房间，不触碰用户正在观看的房间、真实麦克风或设备。

- `npm run build`：类型检查、Vite 前端、现有服务端与助手构建。助手 ZIP SHA-256 仍为 `4c94b6e9c51934513326402fd1d34a21d42da72f3a3052349113f85b38a13307`，没有发布客户端或助手。
- `npm run test:appearance`：真实双端房间、实际 WebSocket、MP4、双向文字聊天、语音收听后换肤、拖拽与停靠、外观记忆、强制颜色、减少动态效果、系统 / 网页全屏。播放器对象、进度和连接保留，换肤没有 loadstart、暂停或房间操作。
- 新增边缘跟随检查：采样聊天室右侧的深浅实际像素，拖动 300px 后新位置仍有深浅照片条块，旧位置没有残留。另检查鼠标后实际画布连续变化，收束后稳定；视频和输入区域保持透明。
- 背景图片实际加载且全窗口 cover；检查 2560×1440、800×1100、1.5 倍 visual viewport、390 / 320px 布局。它们是桌面浏览器视口测试，不是手机真机结论。
- `VS_TEST_SKIN=glitch npm run test:player-controls` 检查实际 MP4 / HLS、暂停、跳转、画面预览、精细定位、网页 / 系统全屏、闲置隐藏与窄屏操作。
- 公网以独立预览和合成新房间验证，视频使用受控 fixture，不等于对 B 站 / 稀饭全部线路或用户环境做了实测。

本机回执与实录：`.local/appearance-evidence.json`、`.local/appearance-public-evidence.json`、`.local/daylight-motion.webm`、`.local/daylight-scroll-evidence.json`、`.local/daylight-public-assets.json`。最终部署信息见下方回执。

参考：[Canvas 绘制与状态](https://html.spec.whatwg.org/dev/canvas.html)、[ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API)、[减少动态效果](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)、[color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme)。

## 部署回执

前一预览 `ab7dacdf`（源码 `8c4f8c0`）是本次用户反馈的基线；本轮完成后以下记录以实际新部署为准。
