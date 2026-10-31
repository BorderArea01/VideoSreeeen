# 0.4.0 验证记录

2026-10-31 用户选定 C「紫电噪讯」，现已接入实际主题选择、三款随机分配与本机记忆。构建、双端播放中切换、语音收听保持、全屏 / 窄屏和视频遮挡检查见 [C 主题验收](appearance-signal.md)。

此前重写的四版纯视觉方案及其验收保留在 [四版方案记录](verification-article-glitch.md)，与实际放映厅验收分别记录。

可选外观、随机分配、播放中切换和故障艺术素材见 [2026-10-31 界面皮肤](appearance.md)。

此前从[四张概念稿](design/glitch-concepts/README.md)中选择的 A，真实界面、隔离验证与独立部署见 [A「天光断层」](appearance-daylight-a.md)。用户现已要求推翻旧外观，以上 A 与[图稿交付检查](design/glitch-concepts-verification.md)、[B 系列预览验证](design/skin-directions-verification.md)均保留为历史记录；当前四版待选方案见上方新记录。

共同缓存面板布局整理、目录选择与桌面 / 窄屏截图见 [2026-10-31 缓存设置界面](verification-cache-ui.md)。

稀饭切换下一集后观众起始黑屏的复现、首帧起播等待与真实 AL 双端验证见 [2026-10-31 下一集首帧](verification-next-start.md)。

最新语音瞬断恢复、聊天室票选移出、分批实际删盘及灰色不可跳转范围见 [2026-10-31 房间稳定性与缓存清理](verification-room-resilience.md)。本轮先在隔离环境完成验收，再集中更新公开网页和同一房间服务；已发布客户端安装包独立记录。

最新的分批磁盘缓存、1/2 与 1/3 首批开播、网页目录授权和 Windows D 盘目录设置见 [2026-10-30 缓存验证](verification-cache-parts.md)。

最新的 B 站观众加载失败、正常登录后的 HTML5 高清取源及助手 0.1.1 部署记录见 [2026-10-28 观众取源修正](verification-bilibili-html5.md)。以下保留历史版本验收。

本页记录 2026-10-18 的 0.4.0 发布成品基线，运行时代码提交为 `1948f376fd388c3fa1ff9e851fbb0f794c68a36b`，发布标签对应同一运行时代码。后续网页版原站播放入口修订及其验证另见 [网页播放修订](verification-web-source.md)。

后续房主本地预览与提供流程的修复、验收及部署进度见 [提供流程验证记录](verification-provider-flow.md)。

随后收到的播放请求被加载中断与黑屏反馈，修订及验证见 [播放器加载冲突修订](verification-playback-lifecycle.md)。

共享者正常、不同网络观众长期连接不成功的现场反馈，见 [跨网络连接状态与恢复](verification-broadcast-recovery.md)；同机公网样片验收不能替代该现场问题的验证。

直连失败后独立 WebSocket 备用音视频通道的实现、阻断直连验收及最新网页部署记录，见 [免费备用视频通道](verification-broadcast-relay.md)。该修订不代表旧版安装包已更新，也不启用收费 TURN。

随后用户要求转发成为正式通道并改善画质、连续性，最新实现与部署见 [正式视频转发验证](verification-primary-video.md)。

播放方式入口整理、原有共同播放的真实解码与 Windows 原站桥接联动，以及后续部署见 [播放方式验证](verification-playback-modes.md)。

用户实际蜜柑页面被一概拒绝的修订、固定线路页面识别与正式入口验收见 [蜜柑页面共同播放](verification-mgn-source.md)。

用户再次反馈两个原站链接均未成功，分别复现、稀饭匿名播放接口与首帧检查的修订见 [原站链接复验](verification-site-source-recheck.md)。蜜柑的原站拒绝问题仍需单独看待。

2026-10-20 的共同播放优先入口和 B 站游客画质复验见 [共同播放与画质](verification-common-priority.md)；稀饭 AL 新番线路识别、1080p 双端实播、下一集与正式部署见 [AL 线路验证](verification-xifan-al.md)。本次仅更新网页和房间服务，未发布新客户端安装包。

后续 Android Edge 现场加载失败、本机重试、诊断与尚未完成的手机验收见 [手机播放失败记录](verification-mobile-source.md)，不能以电脑的移动视口模拟替代该反馈。

用户随后确认可以播放但全员频繁短暂停顿，真实视频中复现的自动前后跳转与播放时钟修订见 [共同播放校时记录](verification-playback-clock.md)。

随后网页缓存下载的 Failed to fetch 复现、容量限制与恢复验证见 [缓存下载修订](verification-cache-download.md)。

2026-10-21 用户继续要求解决慢成员回溯及整集缓存，后续实现和实际验证见 [缓冲隔离与磁盘缓存](verification-buffering-disk.md)。

同日新增的可选房间语音、独立转发、合成音源多人验收和真实设备边界见 [房间语音](verification-voice.md)。

后续用户指出缺少输入 / 输出设备选择，改动与验收见 [语音设备选择](verification-voice-devices.md)。

同日新增稀饭 xfxf1 线路，处理浏览器视频续传失败和下一集初始定位后的自动开播，见 [xfxf1 共同播放](verification-xifan-xfxf1.md)。

2026-10-25 的网页版视频音量、人声优先与网页全屏见 [音量与网页全屏验证](verification-audio-page.md)。

2026-10-25 的全屏自动隐藏、画面预览、上拖精细定位和预设跳转见 [播放器控制验证](verification-player-controls.md)。

2026-10-25 的刷新保留身份、1 秒隐藏与精简底栏见 [刷新与底栏验证](verification-refresh-toolbar.md)，其布局和时间更新上述历史记录。

2026-10-25 的 B 站游客 HTML5 MP4、Windows 房主取源与网页观众共同播放见 [B 站网页共同播放验证](verification-bilibili-web.md)。

2026-10-27 对照 ZNote、复用已有浏览器登录会话的 720p / 1080p 真实取流与网页双端实播见 [B 站已登录会话取源复验](verification-bilibili-authorized-source.md)。随后将高清取源接入 Windows 链接入口的实现与分层验证见 [0.4.5 高清取源接入](verification-bilibili-account.md)，两轮证据不能混同。

## 已实现与自动验证

- 链接同步、Windows 原站画面、桌面浏览器标签页 / 屏幕、本地文件为可选方式；共同缓存默认关闭并折叠，未自动切换。原站画面自动放大播放器，保留播放器内部控件与弹幕，停止共享释放连接与轨道。
- `npm run verify` 的 24 项测试、TypeScript、前端 / Node 构建、Workers 类型检查和 dry-run 通过。`test:onboarding` 验证自动邀请、高级服务器设置、重连、错误源、手机布局；`test:ui` 验证真实解码播放、聊天原图查看、拖拽侧栏及全量缓存清理。
- 本地视频文件通过真实 WebRTC 向另一页面发送音视频，接收 960×540 画面与音轨；暂停、拖动、后来加入及停止清理通过。另一次强制移除 captureStream 的验证走 Canvas / Web Audio 分支，通过同样流程，不能视为 Android 真机通过。
- 模拟浏览器拒绝自动播放，实际点击播放后解除本地限制；解除声音限制不暂停全房间。此检查不等于 Safari 实测。
- `test:p2p` 的浏览器互传、同时下载、损坏块拒绝及源回退、Windows 与浏览器双向传输、退出与缓存清理通过；视频不经房间 WebSocket。既有链接与共同缓存路径保留。
- 独立图片附件验证 2,097,194 字节 GIF 原图字节一致，快照只存引用；无成员凭证、脚本类型、20 MiB 超限及失效引用检查通过。`test:worker` 经 Pages Service Binding 和真实 workerd，验证大图分块持久化、休眠恢复、WebSocket / 成员恢复。

## Windows 成品与更新

- 实际启动 win-unpacked 与便携 EXE；file: 入口、打开网页版、内置房间服务、实际磁盘缓存播放与清理通过。退出仅停止本应用自己的内置服务。
- ASAR 的主程序、更新模块、前端 JS / CSS、原站桥接与工作区逐字节一致；GitHub 更新仓库配置正确。
- NSIS 更新器从本地测试发布源读取 0.4.0 元数据，下载真实 111,008,331 字节安装包，SHA-256 与成品一致；被篡改的更新被拒绝。没有执行覆盖安装或替换现有应用，不能宣称跨版本安装已实机验收。
- Windows 安装版接入应用内更新，便携版仍提供；便携用户首次需切换到安装版。Windows 包没有 Authenticode 签名。

## Android 产物

- `:app:assembleRelease :app:lintRelease` 通过，Lint 0 错误 / 4 警告；固定发布签名，包名 `io.github.borderarea01.videosreeeen`，versionCode 5、versionName 0.4.0，minSdk 26 / targetSdk 35。
- apksigner 验证通过；签名证书 SHA-256：`71d21f595ea8306871b55961ff965c4b72cabe80b9ec2915f6bee9f3290978ba`。
- APK 中的 HTML、活跃 JS / CSS 和 page-bridge.js 与此次前端产物逐字节一致。声明安装更新权限，FileProvider 只开放本应用更新缓存子目录。
- 只生成和检查 APK，未安装、未操作任何 Android 设备。系统安装确认、后台 / 锁屏、文件选择与 WebRTC 收发仍待真机验收。首个正式 APK 不能直接覆盖旧 debug 签名 APK；未自动卸载任何应用。

## 已部署与公网行为

- 公网入口：https://videosreeeen.pages.dev ，健康版本 0.4.0。
- Worker 版本：`5c591256-5c3d-4803-b08c-e3e3f1f5d6c2`。
- Pages 部署：`e649aa76-5c42-4fe5-a024-d3ae78b8d4bc`；部署元数据指向上述运行时代码提交。
- 活跃 JS：`assets/index-Cipeo4Cp.js`，SHA-256 `616eddf57e953aa4739791fb2a78152aaea4eb6737cd8774145c94a25266c122`；在线 HTML、JS、CSS 与此次构建一致。
- 使用实际打包的 Windows 客户端连接公网房间，打开用户提供的 `https://www.bilibili.com/video/BV13Aa66LEAW/`，另一位未登录网页成员接收原站画面及音轨。采集目标 1920×1080 / 30fps，本轮早期接收帧为 1702×956、已解码 31 帧，暂停可回到原站；打开设置期间仍有后续接收帧，停止后清理连接。
- 该 B 站测试使用公开、未登录画面。采集尺寸和接收分辨率不能证明源站已授予高清画质；未替用户登录，登录后高清效果仍需实测。测试进程全程静音，核对音轨、接收字节和音频采样统计，没有做扬声器听感验收。
- 公网图片测试经真实 WSS、Pages 与 Durable Object 上传并原样取回 2,097,194 字节 GIF；聊天快照仅 762 字节。测试已离房，临时房间按服务端 TTL 回收。
- 以上只验证同一台电脑上的客户端；跨运营商 / NAT / 长时播放及 Safari/iOS 未验收。默认仅 STUN，未启用付费 TURN、升级计划或新建付费资源。喜番此前未识别到播放器，不能标记完整兼容；蜜柑仅验证了原站探测，未在本轮做整片共享。

## 分发产物

发布文件已准备到 `artifacts/release/0.4.0/`，包括两端客户端、latest.yml、blockmap、Android update.json 和 SHA256SUMS.txt；Release v0.4.0 已创建、7 个 GitHub 资产摘要均与本地一致；但匿名访问个人主页、仓库和最新 Release 均为 404，Windows 实际在线更新检查也返回 404，公共分发仍未通过。具体证据与需账号本人处理的步骤见 [github-access.md](github-access.md)。安装包来源与更新机制见 [updates.md](updates.md)。

| 产物                     |      字节数 | SHA-256                                                            |
| ------------------------ | ----------: | ------------------------------------------------------------------ |
| VideoSreeeen-Setup.exe   | 111,008,331 | `9a50af69074b75a9be52f81a35f96a2dac2178c0e8e0e0ad8b149a3f1ceddd02` |
| VideoSreeeen 0.4.0.exe   | 110,841,091 | `2a95f3702ea011f4a1548a4245f318e52e4bfd6cce378812624923451b04fe54` |
| VideoSreeeen-Android.apk |   1,584,600 | `dfffbb563d0310f55f2a4c729f95d18b4b0e511ff25b36ea6dbe5af1b6288b4e` |

可重复检查入口：`test:onboarding`、`test:ui`、`test:worker`、`test:p2p`、`test:broadcast`、`test:site-broadcast`、`scripts/package-check.ts`、`scripts/update-check.ts`。结构化原始证据保存在维护机器的忽略目录 `.local/`；历史记录见 [0.3.1](verification-0.3.1.md)。

2026-10-28 B 站改为独立浏览器扩展取源，已移除游客低画质与扫码登录流程；实现、测试、产物、部署和真实播放分别见 [扩展取源验证](verification-browser-extension.md)。此前 B 站客户端与游客记录仅为历史版本证据，不再是当前使用说明。
