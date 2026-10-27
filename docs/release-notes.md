# 0.4.5 · B 站本机账号高清取源

**Windows 房主首次在 B 站官方窗口登录，此后仍只需粘贴视频页面链接；朋友打开邀请，用网页共同观看，无需安装或登录。**

## 这一版更新

- **高清取源接入原有入口**：共同播放默认选择本机账号正常返回的 720p / 1080p AVC 与 AAC 轨道，独立从原 CDN 播放，不录屏、不重新编码、不经房间服务器代理。未返回高清时明确提示，不默默退回游客 360p。
- **登录后继续刚才的链接**：缺少本机登录态时显示“登录 B 站并继续”；完成官方登录并关闭窗口后自动继续。客户端与系统浏览器的登录分开，不导入浏览器 Cookie，也不依赖扩展。
- **完整检查音画后换片**：校验同 BV / 分 P、完整时长、正常权限与临时地址，音视频均可加载才发布。取消、超时、音轨失败或换片期间的旧响应不覆盖当前影片。
- **保留选择**：“原站与视频源”中可手动选游客低画质，或切回各自客户端原站播放器。共享画面、本地视频、喜番各已适配线路继续保留。
- **网页与旧功能兼容**：网页观众识别高清分离音视频；本机重试同步刷新两条轨道，不发布换片或暂停房间。显示实际解码分辨率，安装包包含同期网页功能。

## 下载

| 平台              | 入口                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows x64       | [安装版](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.5/VideoSreeeen-Setup.exe) · [便携版](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.5/VideoSreeeen-Portable-0.4.5.exe) |
| Android 8.0+      | [APK](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.5/VideoSreeeen-Android.apk)，同签名正式版可覆盖更新，需系统确认                                                                                |
| 浏览器 / 苹果设备 | [打开网页版](https://videosreeeen.pages.dev)，通过完整邀请加入                                                                                                                                                           |

[文件校验和](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.5/SHA256SUMS.txt) · [使用说明](https://github.com/BorderArea01/VideoSreeeen#readme) · [反馈问题](https://github.com/BorderArea01/VideoSreeeen/issues/new/choose)

## 验证与边界

同一真实 B 站视频已通过正常登录请求取得完整 AVC 1080p / AAC，在公网房间中双网页实际解码 1920×1080，播放、暂停和跳转通过。本版原生入口的登录继续、双端播放、失败保片和取消使用隔离登录状态与 1080p 测试片验证；这不等于真实账号在新客户端内完成登录后的端到端验收。两类证据分开记录于[高清取源接入验证](https://github.com/BorderArea01/VideoSreeeen/blob/main/docs/verification-bilibili-account.md)。

现有 Cloudflare 出口仍不支持纯网页自动取得 B 站账号高清源，请由 Windows 房主发起。画质取决于原站返回、账号权限、视频与设备；不绕过付费、DRM 或其他访问限制，不共享账号凭据。手机真机、Safari、长片、跨运营商以及真实旧版本覆盖安装仍需分别验收。未启用收费服务。

Windows、Android 构建与 APK 固定签名检查通过，全部 7 个公开发行文件已完整下载并核对摘要，实际 Windows 0.4.5 成品检查公共更新源成功。APK 未安装到设备。

许可证：GPL-3.0-only。
