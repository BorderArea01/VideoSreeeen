# Cloudflare 免费部署

部署目标为 Workers 静态资源 + Workers 路由 + SQLite-backed Durable Objects。每个房间有一个唯一的状态所有者；不需要 VPS、Nginx、Redis 或独立数据库。源码仍维护在 GitHub。

当前公共入口为 **https://videosreeeen.pages.dev**，Pages Functions 经内部 `WATCH` Service Binding 连接 `videosreeeen` Worker。增加此入口的原因是本机访问 `workers.dev` 超时，而 `pages.dev` 可以到达。两种入口共用同一套房间，不建立第二个状态所有者。

## 部署前

先运行受控验证和试打包：

```powershell
./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','verify') -PrioritizeBuildWhenNoGame
./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','test:worker') -PrioritizeBuildWhenNoGame
./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','test:p2p') -PrioritizeBuildWhenNoGame
```

`test:worker` 在本地 workerd 中验证建房、加入、真实 WebSocket、主动休眠后唤醒、成员恢复、原站视频代理关闭与独立备用通道。`test:broadcast-relay` 在浏览器中阻断 WebRTC 候选，验证真实备用视频、音频解码、重新加入和清理。`test:p2p` 使用一个浏览器上下文和 Windows 壳，验证实际视频分块互传。这些测试均不部署云端资源。

只有确认目标账号和部署意图后执行 `npm run worker:deploy`。首次部署会创建名为 `videosreeeen` 的 Worker 与绑定的 `WatchRoom` SQLite Durable Object namespace；`wrangler.jsonc` 使用 `new_sqlite_classes`，适配免费计划。部署前查看同名资源，避免覆盖已有服务。不要修改账号的订阅或启用付费产品。

本机运行所有构建、验证和部署命令时继续使用 `scripts/controlled.ps1`。2026-10-18 用户为本项目明确要求不再因游戏或此前内存门槛中断，使用 `-AllowGameThisRun -MinFreeMiB 0`，仍保留串行、堆上限和所属进程清理；不将此例外用于其他项目。

## 网页与客户端

部署命令返回实际的 `https://…workers.dev` 地址，该地址同时提供网页、`/ws`、`/config`、`/cache-plan`。浏览器打开地址即可使用；Windows 和 Android 的连接设置填写同一个地址。使用完整邀请链接加入会自动填写服务器。

本项目使用 `npm run pages:deploy` 更新 Pages 入口；该命令先将前端和 `pages/_worker.js` 准备到 `.local/pages-dist`，再从 `pages/` 读取独立 Wrangler 配置。`_routes.json` 仅让 API 和 WebSocket 经过 Function，静态页面直接提供。首次创建 Pages 项目时需确认命令实际创建的是 Pages，部分新版 Wrangler 会自动委派为 Workers；已经创建的 Pages 项目无需再次创建。

默认客户端地址在 `.env.production` 的公开变量 `VITE_PUBLIC_SERVER` 中。网页按自身域名连接；Windows / Android 使用该变量，已有保存的服务器设置优先保留。首次上线或域名调整后先验证实际 URL，再构建客户端。

`ALLOWED_ORIGINS` 默认允许站点自身和现有本地客户端来源。若改用 GitHub Pages 或自定义前端域名，需要加入该 HTTPS origin。无需把邀请或成员恢复令牌放入环境变量。

## B 站网页发起（可选）

公共 Cloudflare 出口请求 B 站公开接口会被返回 HTTP 412，因此默认只能由 Windows 房主取源。若希望网页房主也能发起公开 B 站视频，需要额外部署一台可访问 B 站的 Node 取源服务，并配置 Worker 密钥：

```bash
npx wrangler secret put BILIBILI_RESOLVER_URL
npx wrangler secret put BILIBILI_RESOLVER_TOKEN
npx wrangler deploy
```

取源服务只返回公开游客 MP4 的签名地址，不代理视频、不接收 Cookie；视频仍由各端从 B 站 CDN 加载。未配置这两个值时行为不变。部署、安全边界和验证步骤见 [B 站网页取源服务](bilibili-resolver.md)。该出口是额外运维成本，不属于 Cloudflare 免费额度；不要把它描述为“纯网页零依赖”。

## 视频与 P2P

- Worker 处理房间状态、聊天、延迟和 WebRTC 信令；原站视频文件代理 `/media` 仍返回明确的 501。
- 实时画面默认立即使用独立 `/broadcast-relay?room=…` 正式转发，不等待直连失败，不并行建立视频 WebRTC。它由同一房间 Durable Object 鉴权，不使用房间聊天 WebSocket，不持久化视频内容。需要双方刷新到支持此通道的版本；苹果浏览器按实际可用格式协商，不保证旧版支持。
- 转发最多 4 位观众；提供者可选流畅（1.8 Mbit/s）、高清默认（4.5 Mbit/s）或高画质（6 Mbit/s），音频目标 128 kbit/s。每包净载荷最多 64 KiB、每端积压最多 2 MiB，服务端源流量桶允许约 8 Mbit/s。编码器请求约 1 秒关键帧、约 200 ms 输出块，浏览器实际值可能偏离目标。
- 接收端约 2.5 秒起步缓冲，卡顿后可增加到 5 秒，以小幅调速维持缓冲，延迟很大时才跳转。WebM 转发端在内存暂存最多 8 MiB 的近期关键帧和初始化信息，新观众可接入既有编码流；非 WebM 或不支持的输出仍需重新开始容器。无人观看时清理历史并停止编码，休眠恢复时重新编码。接收端约保留 30–45 秒历史缓冲，均不是完整共同缓存。
- MP4 / DASH 的共同缓存使用 WebRTC DataChannel；256 KiB 分块落盘，传输帧为 12 KiB，带背压、长度检查、SHA-256 校验、超时及源站回退。
- 下载者分配不同的优先分块，在缓存过程中即可分享已完成的块；已经缓存完整的成员也可以给后来开始下载的人提供分块。仅当前房间、媒体和缓存代次中的成员可以协商连接，不接入公共 DHT 或 Tracker。
- 每块的声明哈希来自房间成员，用于检查传输一致性；它不是源站签名或独立可信的版权/来源认证。最终每个文件和整部内容仍重新计算指纹，所有成员一致才可播放。
- 原生客户端直接下载可设置原站 Referer，不转发账户 Cookie。浏览器直连受 CORS、编码和配额限制；若原站不允许浏览器下载，可由客户端取得文件并在房间内分享。至少需要一位成员能够取得视频。
- HLS 暂不互传，Windows / Android 保留有限、非加密 HLS 完整下载；Workers 部署下由客户端解析播放列表。浏览器完整 HLS 缓存仍不支持。
- 默认使用 Cloudflare STUN 帮助建立直连，不配置 TURN。`ICE_SERVERS` 可配置为 JSON 数组；TURN 必须另外提供且会产生中继流量，不能把它视为免费无限带宽。
- 苹果浏览器和 Android 的实际后台、锁屏、长视频与跨运营商行为需要分别验收。浏览器单轨最多 96 MiB，总计最多 128 MiB；原生客户端最多 4 GiB，预留 256 MiB 磁盘空间。

## 状态恢复与额度

房间关键状态和有限聊天存入 Durable Object 存储，使用 Hibernation WebSocket API。休眠时不需要定时器常驻；连接附件用于恢复成员身份，视频数据、SDP 与 ICE 候选不写入房间存储。每 30 秒的 alarm 清理超时连接和过期房间，空房间 15 分钟后删除存储。客户端断线重连必须重新确认缓存，不能复用历史 ready。

免费额度同时约束 Worker 请求、Durable Object 请求、活跃时长和存储读写。超限会使服务失败，程序不自动升级付费。少量朋友使用仍需观察 Cloudflare 控制台的真实用量；本地测试不能证明跨网络直连成功率或长期免费额度足够。

部署后必须从实际公网地址验证 HTTPS、WSS、邀请、双端聊天和真实下载。源码、试打包、本地 workerd 通过均不能代替公网部署证据。访问质量也需要在实际使用网络上验证。

参考：[Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[免费额度](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[静态资源计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)、[WebTorrent 浏览器限制](https://webtorrent.io/faq)。
