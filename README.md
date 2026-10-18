# VideoSreeeen

一个不需要浏览器扩展的多人观影程序，采用 **GPL-3.0-only**。

客户端：**Windows、Android、浏览器**。苹果设备通过浏览器加入，不开发 macOS/iOS 原生客户端。

网页版入口：**[打开 VideoSreeeen](https://videosreeeen.pages.dev)**。无需注册、安装扩展或自行部署服务器；新客户端默认使用此公共服务。

## 使用

1. 打开网页版或客户端，创建房间，填写昵称。
2. 把自动生成的邀请链接发给成员，打开链接后即可加入。服务器地址放在高级设置，普通使用无需配置。
3. 在播放器下方选择 **共享画面 / 共同播放 / 本地视频**，仅显示对应操作。点击方式标签只切换输入面板，不会中断正在播放的视频；右上角显示房间当前实际采用的方式。

**共享画面**：默认入口，电脑浏览器选择已经播放视频的标签页，并勾选音频。尚未打开视频时展开“还没打开原站？”；单独打开网页不会开始共享。其他成员接收实时画面，进度在原站操作。

**共同播放**：每人独立从视频源加载，只同步进度，不重新编码。网页版支持可播放的 MP4 / WebM / HLS 视频直链；原站播放器控制需要客户端。网页版在此输入 B 站等原站页面，会明确提示限制，并提供“改用共享画面”，不会替换当前正常播放的视频。HLS 需要源站允许跨域访问，登录、临时地址、防盗链与设备解码支持可能影响可用性，不能保证所有视频源通用。

**本地视频**：选择本机文件后实时提供，不需要整部上传。提供者保持在线，房间可同步暂停、进度与倍速；推荐 H.264 / AAC 的 MP4。

| 方式              | 使用场景                                | 特点                                                                  |
| ----------------- | --------------------------------------- | --------------------------------------------------------------------- |
| 共同播放          | 视频直链或客户端内的原站播放器          | 每人自行播放，保留原始画质；各自需要相应访问权限                      |
| 共享原站画面      | 一位 Windows 成员在客户端打开并登录原站 | 点“共享原站画面”，其他成员接收音视频，无需登录提供方账号；不传 Cookie |
| 标签页 / 屏幕共享 | 桌面浏览器已经打开播放器                | 通过浏览器选择标签页并勾选音频；进度和速度在提供方原播放器调整        |
| 本地视频          | 自己的视频文件                          | 点“打开视频文件”，选择后向房间实时发送，无需整部上传，提供者需在线    |

共同播放、本地文件及可控原站保留多人操作与服务端冲突裁决。标签页 / 屏幕共享在原站控制进度，观众只有本机声音与全屏。实时画面默认经独立视频 WebSocket 转发，采集目标最高 1080p / 30fps，按网络与设备条件调整，重新编码不保证原画无损。Android 与浏览器可以接收；Android 本地文件使用视频元素或 Canvas / Web Audio 提供画面，真机与 Safari/iOS 尚未验证。推荐 H.264/AAC MP4，其他格式取决于设备解码器。

**共同缓存默认关闭。** 仅在大家都卡时展开“共同缓存”手动启用；适用于可完整下载的 MP4 / DASH 等源，各人完整落盘并校验一致后播放，看完清理。实时画面不使用共同缓存。浏览器完整缓存上限仍为 128 MiB，长视频缓存使用客户端。

聊天室支持文字、Emoji 和单张最多 **20 MiB** 的 GIF / PNG / JPEG / WebP 原图，点击查看原图，GIF 不强制转成静态图片。图片独立传输，聊天快照只存引用；单房间图片总量 64 MiB，历史滚动或房间过期后清理。侧栏可以隐藏、拖拽，成员旁显示到房间服务的真实 RTT。

**客户端：[Windows 安装版](https://github.com/BorderArea01/VideoSreeeen/releases/latest/download/VideoSreeeen-Setup.exe) · [Android APK](https://github.com/BorderArea01/VideoSreeeen/releases/latest/download/VideoSreeeen-Android.apk) · [全部版本与校验和](https://github.com/BorderArea01/VideoSreeeen/releases)。**

当前 GitHub 账号的匿名公开访问异常：主页、仓库和 Release 返回 404，公共下载与在线更新暂不可用；安装包已生成并上传，详情和支持请求草稿见 [github-access.md](docs/github-access.md)。网页与房间服务可使用。

Windows 安装版支持应用内下载和重启更新，便携版仍提供。Android 应用内下载后交给系统确认安装，正式版保持固定包名和签名，不需要卸载旧版；之前的 debug APK 与首个正式 APK 签名不同，不能直接覆盖。苹果设备使用网页版。发布与签名维护见 [updates.md](docs/updates.md)。

原站的登录、画质与付费权限仍由原站决定，提供方自行完成验证。浏览器不能直接控制跨站 iframe；可以接收成员共享的实时音视频。画面默认通过独立 WebSocket 正式转发，不再等待直连失败，也不并行启动视频 WebRTC 编码。共享者可选流畅、高清（默认）或高画质；接收端使用约 2.5 秒起步的短缓冲抵御网络波动。使用现有 Workers Free 额度，不启用收费 TURN，额度超限时会不可用。共同缓存仍是单独的手动模式。

邀请包含入房凭证，请发给预期成员。六位房间号不能独立加入，跨服务器请使用完整邀请链接。Windows、Android、公开网页的验证边界见 [verification.md](docs/verification.md)。

![VideoSreeeen 桌面界面](docs/screenshots/desktop.png)

## 本地启动

需要 Node.js 22+、npm。开发依赖使用锁文件固定。

```powershell
npm ci
npm run build
npm start
```

浏览器打开 `http://localhost:8787`。Windows 可直接运行便携版 EXE，或运行 `npm run desktop`；顶部的“打开网页版”会打开当前服务器地址。Windows 客户端仍内置房间服务，可以在连接设置切换到电脑的局域网地址。端口被其他进程占用时改用空闲端口，不停止其他进程。退出 Windows 客户端会停止它自己的内置服务，不影响公共服务。

手机使用默认公共服务时不需配置。自建用户在高级设置填写可达地址，而不是手机自己的 `localhost`；完整邀请自动选择对应服务器。局域网外自建需要部署公网 HTTPS 服务。Windows 防火墙需允许对应端口连接，程序不会自行修改防火墙。本机开发请遵守下方受控构建要求。

开发时可分别运行 `npm run dev`（房间服务）和 `npm run dev:ui`（界面）。公开服务必须配置 HTTPS/WSS，代理需支持 WebSocket。Node 自建服务可转发链接视频；实时画面默认使用独立 `/broadcast-relay` 通道，原有直连实现保留供兼容部署使用。

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
