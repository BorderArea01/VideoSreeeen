# 第三方与参考

本项目采用 GPL-3.0-only，完整许可证见 LICENSE。运行时第三方依赖各自保留原许可证；依赖精确版本见 package-lock.json。

- Electron / Electron Builder / electron-updater：Windows 壳、打包与 NSIS 增量更新；MIT，Chromium 另含其第三方声明，随 Electron 运行时分发。
- AndroidX WebKit：Android WebView 跨 frame 的文档开始脚本与只读播放器探测；Apache-2.0。
- hls.js：HLS 播放；Apache-2.0。
- @noble/hashes 2.4.0：浏览器磁盘文件流式 SHA-256 校验；MIT，完整许可随网页的 `licenses/noble-hashes.txt` 分发，源文件见 `client/public/licenses/noble-hashes.txt`。
- ws、Zod、ipaddr.js：WebSocket、消息校验与 IP 地址校验；MIT。
- qrcode-generator 2.0.4：在浏览器本地生成官方登录链接的二维码，不向第三方二维码服务发送登录链接；MIT，完整许可随网页的 `licenses/qrcode-generator.txt` 分发。
- TypeScript、Vite、tsx、esbuild、Playwright：开发与验证工具，依原包许可证使用。
- Wrangler、Miniflare、Cloudflare Workers Types：Cloudflare 构建、本地 workerd 验证和类型；MIT / Apache-2.0，依各包 LICENSE 保留。P2P 使用浏览器 WebRTC API 自行实现，没有将 WebTorrent 或公共 Tracker 打包进客户端。

研究参考：

- https://github.com/sky1wu/Bili-SyncPlay （GPL-3.0）：多人状态裁决、分级纠偏、协议与运维边界。
- https://github.com/VideoTogether/VideoTogether （MIT）：跨站播放器适配与跨设备观影场景。
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://developer.android.com/reference/android/webkit/WebView
- https://developer.android.com/reference/androidx/webkit/WebViewCompat
- https://webtorrent.io/faq
- https://github.com/Novage/p2p-media-loader
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/

项目代码为独立实现，未整体导入这两个参考项目。测试真实视频使用 MDN 提供的 CC0 flower.mp4，只在验收时获取，不提交仓库或分发到安装包。
