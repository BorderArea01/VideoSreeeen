# 视频源助手：房主安装一次，观众只用网页

这是 VideoSreeeen 自己的轻量浏览器扩展，适用于电脑 Edge / Chrome。只负责 B 站高清取源，所有播放、聊天、语音仍在放映厅网页操作。复用**同一浏览器配置文件**里已有的正常 B 站登录；已经登录就不必再扫码。未登录时去 B 站正常登录，再回房间点击同步。

当前助手版本为 **0.1.2**，修正大合集视频的“B 站响应超过大小限制”，保留此前正常 HTML5 高清取源修正。已安装 0.1.0 / 0.1.1 的房主从下面的网页入口下载更新，覆盖原解压目录并重新加载；结束当前观看后刷新放映厅，再同步链接。观众无需安装。原始 v0.4.6 Release 中的扩展 ZIP 为 0.1.0 历史产物，保持不变；最新助手通过本页的网页下载入口分发。[大小限制修复及验证](verification-bilibili-metadata-size.md)。

## 安装

目前提供开源 ZIP，尚未上架扩展商店。开发者模式安装是一次性步骤，后续使用只需粘贴链接。

1. [下载视频源助手](https://videosreeeen.pages.dev/downloads/VideoSreeeen-SourceHelper.zip)，将 ZIP 解压到固定文件夹，保留该文件夹。
2. Edge 地址栏打开 `edge://extensions`（Chrome 使用 `chrome://extensions`），开启“开发人员模式”。
3. 点击“加载解压缩的扩展”（Chrome 为“加载已解压的扩展程序”），选择**含有 manifest.json 的解压文件夹**。
4. 刷新 [VideoSreeeen 放映厅](https://videosreeeen.pages.dev)，在“共同播放”粘贴 B 站视频链接并同步。

只有提供视频源的房主需要安装，手机、苹果设备及其他观众不需要安装。B 站登录与扩展需在同一浏览器配置文件中；无痕窗口、其他浏览器和客户端的会话不互通。

## 使用

房主浏览器已有 B 站登录 → 放映厅粘贴 `https://www.bilibili.com/video/BV…/` → 同步此链接 → 检查两条音视频轨道 → 房间成员各自从原 CDN 播放。支持视频自带的分 P；“下一分 P”由装有扩展的成员发起。

- 未检测到扩展时显示安装入口；没有登录时只显示“去 B 站登录”，不生成二维码、不要求复制 Cookie。
- 默认选择原站向当前账号正常提供的完整 720p / 1080p AVC 与 AAC 轨道。只返回低画质、试看、DRM、过期地址或轨道加载失败时保留当前影片。
- 使用正常登录后的 HTML5 高清 DASH 签发线路，避免把原站桌面线路不能外部播放的地址交给观众。保留原站返回的签名，不改域名、端口或签发参数，不伪造请求头；游客低画质取源没有恢复。
- 观众无需扩展或登录。视频地址失效时，提供者可重新同步原页面链接；普通观众的“重试本机视频”只重载自己，不更换房间媒体。
- 客户端继续接收房间视频。B 站浏览器取源请在电脑浏览器使用；客户端的原站播放器仍保留为手动选项。
- 更新 ZIP 后覆盖原解压文件夹，在扩展管理页点击“重新加载”，然后刷新放映厅。移除时在扩展管理页删除即可，不改动 B 站账号数据。

## 权限与隐私

仅申请 `https://api.bilibili.com/*` 主机访问权限；网页桥接只在正式放映厅和本机开发地址生效。扩展后台只允许登录状态、指定 BV 信息与正常高清播放三个只读接口，不提供任意 URL 请求接口。不申请 cookies、下载、浏览历史、屏幕或麦克风权限。

请求通过浏览器的 `credentials: include` 使用既有会话，代码不读取或导出 Cookie 值；原始账号响应不返回放映厅。网页和房间只收到校验后的影片元数据与原站临时音视频地址，账号会话不经过 Cloudflare 或 Node 服务。

响应按接口分别限额：登录状态 64 KiB、视频信息 8 MiB、播放信息 512 KiB。视频信息可能附带很大的合集目录；目录只在扩展内解析，不发往房间。读取过程中按实际响应字节计数，不依赖 `Content-Length`，超限或取消会关闭流；这些是元数据保护，不是视频时长或缓存容量限制。

源站访问权限和视频 CDN 限制仍然有效；扩展不绕过登录、付费、DRM 或其他访问控制。跨地区、移动浏览器与长片效果以实际验收为准。参见 [Chrome 跨域请求文档](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)。

## 从源码构建

```powershell
npm ci
npm run build
npm run build:extension
node scripts/zip-extension.mjs
```

加载目录为 `artifacts/browser-extension`，分发包为 `artifacts/VideoSreeeen-SourceHelper.zip`；网站构建中的副本位于 `dist/downloads`。许可证 GPL-3.0-only，ZIP 附带 LICENSE。不包含 ZNote 代码或依赖。

自动验收：准备 FFmpeg（或设置 `VS_FFMPEG`），运行 `npm run test:extension`。验证记录见 [扩展取源验收](verification-browser-extension.md)。
