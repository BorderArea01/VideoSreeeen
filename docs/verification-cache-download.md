# 网页缓存 Failed to fetch

本页保留 2026-10-20 的容量限制与修复基线；2026-10-21 的流式磁盘缓存和慢成员隔离见 [后续修订](verification-buffering-disk.md)。

2026-10-20 用户反馈“本地缓存显示 fail to fetch”。本轮在正式网页使用此前的稀饭 AL `3434/play/203799?source=AL` 复现，未操作用户手机、原房间或本机账号。

## 复现与原因

- 房间 `/cache-plan` 返回 200，失败发生在视频 CDN 的下载请求，不是房间服务停止。
- 先用普通 video 元素播放后，默认 fetch 的 HEAD 和单字节 Range 均失败。浏览器网络诊断明确给出 `MissingAllowOriginHeader`，并复用此前未带跨域许可头的媒体响应。
- 同一原站签发 URL，改用 `cache: no-store` 后，HEAD 返回 200，Range 返回 206，响应允许当前网页 Origin。不修改临时 URL、签发参数或权限。
- 完整视频为 **413,116,624 字节，约 394.0 MiB**。当前浏览器缓存为单轨 96 MiB、合计 128 MiB，源站又没有向网页公开 Content-Range，因此不能宣称这集在网页已能完整缓存。正常 video 播放与脚本下载的跨域条件不同。

参考 [Fetch 缓存模式](https://fetch.spec.whatwg.org/#concept-request-cache-mode)、[Range](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range) 与 [跨域响应头可见性](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Expose-Headers)。没有引入第三方下载器或开启 Cloudflare 视频代理。

## 修订

- 房间缓存计划和视频下载独立请求，使用 no-store、omit credentials。计划、源站连接、HTTP 拒绝、超时、容量和分块校验失败分别说明；浏览器无法区分网络与 CORS 的场合保持不确定性，不把底层带签发参数的错误上传房间。
- Range 响应未公开视频总大小时，额外进行仅元数据的 HEAD，识别容量限制。不把 Content-Length 的单个分块大小误当视频大小，不绕过原有分块范围及长度校验。
- 规划、探测或写入任一步失败均清理本应用任务，不清理后来替换的任务。错误不能成为 ready，原有全员完整落盘、相同指纹和换代门槛不变。
- 失败面板提供“重试本机缓存”和“返回边播边看”；后者明确由用户关闭全房间缓存，没有自动改播放模式。容量在折叠说明中提前列明；错误面板隐藏无意义的进度条，不重复弹出同一条提示。
- 容量上限保持原值。当前网页最终组装 Blob 和计算整文件指纹需要内存，不能通过扩大数值解决整集缓存；大文件需要另行实现流式存储与读取。没有把普通预加载、部分分块或服务器缓存称为完整缓存。

## 验证

`npm run verify` 已通过 72 项测试、构建、Worker 类型及 dry-run。新增测试验证 no-store、无凭据、错误范围／短块／超长块拒绝、缺少公开范围时的大小探测、容量边界、请求取消，以及错误脱敏。

`VS_CACHE_REAL_AL=1 npm run test:cache-download` 的本地验收通过：

- 两份独立浏览器资料各完整持久化 1,128,375 字节 CC0 MP4，逐个读取 Cache Storage 校验字节总数；双方内容指纹均为 `cdff61d4d1faf88190cde24dc6573be939e97037d787d5e1feff57f585fc50da`。不是只检查进度条。
- 故意中断观众读取缓存计划，房间保持不可播放；解除故障后重试成功，两端就绪才放行。缓存视频实际播放并自然结束，两端应用缓存都删除。
- 同一 AL 原站真实识别和 CDN 请求得到 394.0 MiB 的容量提示，没有 Failed to fetch，也没有缓存就绪。返回边播边看后两端实际继续播放。
- 覆盖 Windows 浏览器与 Pixel 7 视口，截图核对布局；这仍是电脑上的浏览器测试，不能替代 Android 真机或异地网络验收。

`npm run test:p2p` 回归通过浏览器互传、共同分担源站下载、损坏块拒绝及源站回退、Windows 与浏览器双向传块、种子离开及自然结束清理。Windows 使用独立测试资料目录，没有读取用户登录会话。

本轮未更新客户端安装包，未安装设备，未开启付费服务。Windows / Android 的大文件落盘路径保留，但不以小样片或浏览器测试宣称该 AL 整集已在原生客户端缓存通过。

## 部署

沿用已确认账号和现有免费资源，没有迁移房间状态或修改服务绑定。

- 运行时提交：`5d003f6db45f12a9c0e6be0eeb9777bca1fbb4e7`，已推送 GitHub。
- Worker：`c445ad50-fb28-48a8-ab41-7ea494b18849`。
- Pages：`607f7de7-9ba4-4cf5-840a-8cd24c06f42d`。
- 正式入口：[videosreeeen.pages.dev](https://videosreeeen.pages.dev)，健康版本仍为 0.4.3。
- 活跃 JS：`assets/index-C7Ju689p.js`，SHA-256 `4ed7d72c375cd7a57c22163944128699d422605bb554016484b6702b41361441`。
- 活跃 CSS：`assets/index-Cmi4kqGf.css`，SHA-256 `e5434e9dee7baa4cb29df91a7e5618d3fa5050e78aa5a51169f42691ff230303`。
- 正式 HTML、JS、CSS 与本次构建逐字节一致，Pages 元数据指向上述提交。

正式入口的同一下载验收通过：两端各持久化 1,128,375 字节、全员相同指纹、计划请求中断后重试、实际缓存播放及结束清理；AL 返回真实 394.0 MiB 的容量说明，返回普通共同播放后继续出帧。手机视口截图确认失败面板、重试和返回按钮可见，隐藏无意义进度条，也没有重复报错浮层。

首轮公网验收因测试工具直连 `/config` 超时中断，改用维护机现有 Clash HTTP 代理后完整通过；这是测试机器的出站代理，不是 Cloudflare 原站视频代理。脚本通过可选 `VS_TEST_PROXY` 指定代理，不强制其他开源使用者安装 Clash。公网仍为同机两份浏览器资料，不是异地或手机真机证明。

脱敏原始记录保存在忽略目录 `.local/cache-ui-before.json`、`.local/cache-download-local-evidence.json`、`.local/cache-download-public-evidence.json`、`.local/public-cache-assets-evidence.json`。早期下载验收 JSON 中的 `proxy: false` 指未启用视频服务代理；新版字段明确区分 `videoProxy` 与测试机 `networkProxy`。
