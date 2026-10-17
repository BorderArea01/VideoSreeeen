# VideoSreeeen

同一刻，同一幕。一个不需要浏览器扩展的多人观影程序，采用 **GPL-3.0-only**。

客户端：**Windows、Android、浏览器**。苹果设备通过浏览器加入，不开发 macOS/iOS 原生客户端。

网页版入口：**[打开 VideoSreeeen](https://videosreeeen.pages.dev)**。无需注册、安装扩展或自行部署服务器；新客户端默认使用此公共服务。

## 先一起看起来

1. 打开网页版或客户端，点“开启我们的放映室”，填昵称，创建房间。
2. 房间自动生成邀请链接，点击复制后发给朋友。朋友打开链接，填昵称即可加入；也可以点“我有邀请”粘贴完整邀请。
3. 在“今晚看什么”粘贴视频地址。视频直链可直接播放；B 站、喜番、蜜柑页面需要一位 Windows / Android 成员打开，新版客户端检测到视频后自动共享可播放源。每个人都能控制播放；右侧可以聊天、发 Emoji 和图片。
4. 网络较慢时开启“共同缓存”，各自在本机点击开始缓存，全部准备好后一起播放。看完自动清理本应用创建的缓存。

邀请链接已包含服务器信息和入房凭证，请只发给朋友。六位房间号只是标识，不能单独加入；完整邀请码适用于相同服务器，跨服务器请使用链接。邀请失效时重新建房。

**选哪个入口？** Windows / Android 客户端适合打开原站、识别视频源和缓存长视频；苹果设备直接用浏览器。浏览器可看视频直链或客户端共享的源，但无法控制第三方网站内的播放器，完整缓存目前限总计 128 MiB。具体站点状态与限制见下方。

**粘贴 B 站链接后显示等待识别？** 这表示房间只有网页地址，尚未获得视频文件。需要 Windows / Android 成员加入同一房间并打开该视频；0.3.1 会自动识别，旧版可点“识别并共享原站视频源”。只有浏览器成员时，目前无法直接同步这些原站页面。若源站拒绝浏览器直接播放，可点“改用共同缓存”，各自开始缓存，由客户端向网页互传。这个过程保留原站的登录和访问限制，不安装扩展、不上传 Cookie，也不把仅能展示的 iframe 当作同步成功。

**客户端获取：** 当前是开发测试阶段，尚未发布可公开下载的安装包；本机 Windows 便携 EXE、Android 调试 APK 的产物与验证记录见 [verification.md](docs/verification.md)。维护者发布测试版前需附实际产物、SHA-256、对应提交和兼容边界；Android 正式发行还需要独立保管的稳定签名。GitHub Actions 目前因账号权限停用，不能宣称自动构建或发布可用。

**普通使用无需填服务器。** 只有自建或局域网用户才需打开“设置与帮助 → 高级 · 房间服务器”。保存后用于下次建房或使用邀请码加入，不会切换当前房间；完整邀请优先使用邀请中的服务器，也不会覆盖默认设置。应用内还提供使用指引、端能力说明和反馈入口。

![VideoSreeeen 桌面界面](docs/screenshots/desktop.png)

## 能力

- 自动生成邀请链接/邀请码；打开邀请直接进入加入页，无需注册；最多 16 位成员。
- 每个人都能播放、暂停、拖动和调速；服务端按版本裁决并发操作，过期操作明确提示，自动跟随不循环广播。
- WebSocket 推送、单调时间推算、小误差调速、大误差跳转。
- 可隐藏/拖拽悬浮的聊天侧栏，文字、Emoji、GIF/PNG/JPEG/WebP 表情图片（最大 256 KiB）。
- 真实显示每位成员到房间服务端的 RTT；未知或断线时显示“—”。
- 共同缓存：MP4 / DASH 支持房间内 P2P 分块互传，失败回退下载；每人仍需完整落盘，所有人内容指纹一致才能播放。退出、换片、全员自然结束后清理应用缓存；任务失败不自动重试。
- Windows/Android 客户端内打开原站，独立保存原站登录状态；检测到可访问视频后自动共享给浏览器成员，保留客户端原站播放。仍可手动重新识别。

## 网站兼容边界

优先目标：Bilibili `/video/BV…`（含分 P）、喜番 `next.xifanacg.com`、蜜柑 `mgnacg.com`。URL 入口、原站视图、播放器探测和视频源提取已经接入；真实验收结果以 [verification.md](docs/verification.md) 为准。

原站出现登录、验证码、付费限制时需在客户端按原站规则处理。无法提取、签名失效、直播、加密 HLS 和不支持的编码会显示失败，不宣称已缓存。服务器不转发账户 Cookie，也不解除访问限制。

浏览器不能控制第三方网页内的播放器。浏览器成员使用内置播放器观看视频直链或客户端识别后共享的源；需要 HTTPS 才能可靠使用剪贴板和浏览器存储。不能把网站页面 iframe 展示当成已实现同步。

## 本地启动

需要 Node.js 22+、npm。开发依赖使用锁文件固定。

```powershell
npm ci
npm run build
npm start
```

浏览器打开 `http://localhost:8787`。Windows 可直接运行便携版 EXE，或运行 `npm run desktop`；顶部的“打开网页版”会打开当前服务器地址。Windows 客户端仍内置房间服务，可以在连接设置切换到电脑的局域网地址。端口被其他进程占用时改用空闲端口，不停止其他进程。退出 Windows 客户端会停止它自己的内置服务，不影响公共服务。

手机使用默认公共服务时不需配置。自建用户在高级设置填写可达地址，而不是手机自己的 `localhost`；完整邀请自动选择对应服务器。局域网外自建需要部署公网 HTTPS 服务。Windows 防火墙需允许对应端口连接，程序不会自行修改防火墙。本机开发请遵守下方受控构建要求。

开发时可分别运行 `npm run dev`（房间服务）和 `npm run dev:ui`（界面）。公开服务必须配置 HTTPS/WSS，代理需支持 WebSocket。服务会中转共享的视频流，带宽消耗随同时观看/下载人数增长。

## 构建与验证

本机已经授权无游戏时直接构建，但每轮都必须检测真实游戏进程和资源，不依据窗口或网页标题判断。

```powershell
./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','build') -PrioritizeBuildWhenNoGame
./scripts/controlled.ps1 -File npm.cmd -Arguments @('test') -PrioritizeBuildWhenNoGame
./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','package:windows') -PrioritizeBuildWhenNoGame
./scripts/build-android.ps1 -SdkRoot '你的 Android SDK 目录' -Gradle '你的 Gradle 8.13/bin/gradle.bat'
```

Android 需要 JDK 17+、Android SDK 35、Gradle 8.13。输出调试 APK 为新的独立包 `io.github.borderarea01.videosreeeen`，不覆盖其他应用。Android 发行签名应单独配置，不提交 keystore。

`npm run test:ui` 使用一个 Edge 浏览器上下文、两个页面验证实际房间和真实 CC0 视频，再串行检查 Windows 壳及目标站点；全程静音，截图和结构化证据位于 `.local/`。需要本机 Edge。公网媒体或站点不可访问会导致相应验收失败，不作为通过处理。

## 共同缓存的范围

Windows/Android：支持完整文件、分离音视频和有限、非加密 HLS（含音频子列表）；流式落盘，默认最多 4 GiB 且预留 256 MiB 磁盘空间。直播、加密、字节范围 HLS 和超过分片上限的源明确拒绝。所有端必须选择相同媒体版本。

浏览器：当前支持带已知长度的小型文件/分离音视频完整缓存，每轨最多 96 MiB、总计最多 128 MiB，并受存储配额限制；大视频和完整 HLS 缓存请使用客户端。分块先落存储，最后在有上限的内存中组装播放；原生端不整片读入内存。浏览器异常退出的缓存下次访问超过 24 小时才清理，避免清理其他活跃标签页。原生客户端下次启动会清扫上次遗留的应用缓存。

自动清理不删除用户原有视频或其他应用数据。全员结束前，先结束的成员仍保留自己的缓存，方便等候其他人。

## 部署

0.2 提供 **Cloudflare Workers + Durable Objects 免费计划适配**，同一个地址提供网页、房间、聊天和同步；视频由成员设备互传或直接下载。部署步骤、免费额度和兼容边界见 [cloudflare.md](docs/cloudflare.md)。本地测试通过不代表已上线，实际部署状态见 [verification.md](docs/verification.md)。

当前使用 Pages 免费入口，通过内部 Service Binding 连接房间 Worker，避免客户端必须访问 `workers.dev`。`.env.production` 只保存可公开的默认服务网址；自行部署时替换 `VITE_PUBLIC_SERVER`，不要在其中放密钥。

原有 Node 自建部署继续保留，提供视频中转：

可使用 [Dockerfile](Dockerfile) 或 [compose.yaml](compose.yaml)。`PORT` 默认 8787，`HOST` 默认 `0.0.0.0`；`ALLOWED_ORIGINS` 为逗号分隔的允许来源，请加入实际网站的 HTTPS origin，并保留需要的原生客户端 origin。

```text
公网 HTTPS/WSS 代理 → VideoSreeeen :8787 → 公网视频源
```

首版房间与聊天在内存中；进程重启后邀请失效，需要重新建房。空房间保留 15 分钟；断线席位等待 30 秒。首版不支持多节点共享房间。`/healthz` 提供健康检查，不包含邀请和成员令牌。

更多设计见 [architecture.md](docs/architecture.md)，参与和反馈见 [贡献指南](CONTRIBUTING.md)。代码仓库：[BorderArea01/VideoSreeeen](https://github.com/BorderArea01/VideoSreeeen)。
