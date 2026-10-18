新增客户端“设置与帮助 → 原站账号 · B 站登录”：在官方页面登录，会话仅保留本机，关闭窗口后刷新当前 B 站播放器。共同播放使用每位用户自己的原站权限，仍可选择共享画面给观众。

- 修复原站第一次拖动可能丢失，适配 B 站新版播放器的视频源信息。
- Windows 双客户端实测通过 B 站游客 360p、蜜柑 1080p 的播放、暂停、进度、倍速及原站拖动同步；保留稀饭网页识别。
- B 站提取地址仍可能被 CDN 拒绝，不能保证浏览器观众通过直链播放；蜜柑纯网页识别仍为实验支持。Android 登录后高清、Android 真机及 Safari/iOS 尚未验收。

Windows 安装版 VideoSreeeen-Setup.exe 支持应用内更新；便携版 VideoSreeeen-Portable-0.4.1.exe。Android 使用 VideoSreeeen-Android.apk，同一发布签名，更新由系统确认。没有安装或卸载任何设备应用。苹果设备使用 [网页版](https://videosreeeen.pages.dev)。校验见 SHA256SUMS.txt。

实时共享画面默认走现有 WebSocket 转发，保持零付费授权，没有启用 TURN 或服务器托管登录会话。Windows 安装包没有 Authenticode 证书。源码许可证 GPL-3.0-only。
