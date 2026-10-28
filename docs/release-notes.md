# 0.4.6 · B 站浏览器视频源助手

**2026-10-28 网页修正：视频源助手已更新为 0.1.1。** 部分视频的桌面 CDN 签名会导致观众端 HTTP 403，现改用正常登录后的 HTML5 高清 DASH 签发线路，仍只接受完整 720p / 1080p AVC 与 AAC。旧助手会提示更新。使用下面的网页入口下载最新版助手；原始 v0.4.6 发行资产保留不变，未重新打包客户端。

房主在电脑 Edge / Chrome 安装一次轻量助手，在放映厅粘贴 B 站链接即可取源；观众只用网页。复用同一浏览器已登录的 B 站账号，不再另外扫码或复制令牌。

- 新增独立 Manifest V3 扩展，约 18 KB；只访问固定 B 站只读接口，不申请 cookies 权限，不读取或导出 Cookie 值。
- 账号会话留在房主浏览器。两条完整高清音视频轨道检查可加载后才发布，各端从原 CDN 播放，同步暂停、跳转和倍速。
- 删除游客低画质取源、手动画质降级菜单、服务端扫码实验与 Windows / Android 专用 B 站登录窗口。
- 修正原站正常返回的 MCDN 8082 端口被旧校验错误丢弃的问题，保留完整签名，优先正常 MCDN 源；不伪造原站 Referer、不代理视频。
- 保留其他站点、共享画面、本地文件、聊天室、弹幕、语音与共同缓存。客户端可接收视频，B 站取源请在电脑浏览器发起；客户端原站播放保留为手动选项。

## 使用与下载

[打开网页版](https://videosreeeen.pages.dev) · [最新视频源助手 ZIP](https://videosreeeen.pages.dev/downloads/VideoSreeeen-SourceHelper.zip) · [一次性安装步骤](https://github.com/BorderArea01/VideoSreeeen/blob/main/docs/browser-extension.md)

当前为开源解压安装，尚未上架扩展商店。Edge 在 edge://extensions 开启开发人员模式后，加载解压后含 manifest.json 的文件夹，刷新放映厅即可。只有提供视频源的人需要安装。

[Windows 安装版](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.6/VideoSreeeen-Setup.exe) · [便携版](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.6/VideoSreeeen-Portable-0.4.6.exe) · [Android APK](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.6/VideoSreeeen-Android.apk) · [校验和](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.6/SHA256SUMS.txt)

## 验证与边界

当前 Edge 已安装本项目自己的扩展；使用已有正常登录与真实 B 站视频，两端网页实际解码 1920×1080 / AAC，暂停和播放中跳至 30 秒通过。独立观众端没有扩展或 B 站登录。97 项测试、扩展隔离加载及合成双端播放、下一分 P、取消和失效保片检查通过。详见[分层验证记录](https://github.com/BorderArea01/VideoSreeeen/blob/main/docs/verification-browser-extension.md)。

真实检查为同机双浏览器访问互联网视频源，不代表跨运营商、手机、Safari、长片或所有 B 站视频均已通过。画质取决于原站正常返回的完整 AVC / AAC 轨道；不绕过登录、付费、DRM 或访问控制。Windows / Android 不要求观众安装扩展，APK 未安装到设备。本轮未启用收费服务。

GPL-3.0-only。
