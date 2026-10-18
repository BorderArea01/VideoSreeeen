0.4.2 完善观影界面：

- 共同缓存收进“共同播放 → 网络卡顿时：先完整缓存”，默认关闭；全员完整下载后再播，看完清理，不用于实时共享画面。
- 成员列表和底部统一使用服务端实测 RTT。约 5 秒采样，15 秒无新样本隐藏旧数字；这不是画面缓冲延迟。
- 聊天室文字和 Emoji 实时弹幕，支持开关、隐藏聊天室和全屏。加入、重连及关闭期间消息不补播，图片仍在聊天室。
- Windows 原站弹幕使用独立可信覆盖层，不把聊天注入原站页面。保留 B 站本机登录、原有共同播放与画面共享。

Windows 安装版 VideoSreeeen-Setup.exe；便携版 VideoSreeeen-Portable-0.4.2.exe。Android 使用同一签名的 VideoSreeeen-Android.apk，更新需系统确认；本轮不安装设备。Android 真机与 Safari/iOS 尚未验收。

网页入口：https://videosreeeen.pages.dev 。源码 GPL-3.0-only。GitHub 未登录公开下载此前仍返回 404，不能把认证 API 发布成功当作自动更新已可用；本机保留产物供直接取用。未启用收费产品。
