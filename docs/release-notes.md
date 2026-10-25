0.4.4 新增 B 站游客兼容共同播放：

- 房主使用 Windows 客户端粘贴公开 BV 页面，默认在本机获取游客 MP4；朋友只打开网页加入，无需安装客户端或登录 B 站。各自从原 CDN 加载，同步播放控制，不共享屏幕或重新编码。
- 已实播验证 640×360 与音频，不承诺游客 1080p。高级“原站与视频源”可取消游客兼容模式，保留原客户端登录与原站播放。
- 首帧通过后才换片；取消、失败不影响当前影片。Windows 本机取源可取消、有超时与响应大小限制，不读取或上传账号 Cookie。
- 现有 Cloudflare 出口被 B 站返回 HTTP 412，因此公共服务尚不支持全员纯网页发起 B 站播放；由 Windows 房主取源后，网页观众可以直接观看。

Windows 安装版 VideoSreeeen-Setup.exe；便携版 VideoSreeeen-Portable-0.4.4.exe。Android 使用同一签名的 VideoSreeeen-Android.apk，更新需系统确认；本轮只生成 APK，不安装设备。Android 真机与 Safari/iOS 尚未验收。

网页入口：https://videosreeeen.pages.dev 。源码 GPL-3.0-only。GitHub 未登录公开下载此前仍返回 404，不能把认证 API 发布成功当作自动更新已可用；本机保留产物供直接取用。未启用收费产品。
