提供三种可选播放方式：链接同步、实时画面共享、本地视频文件共享。共同缓存保留为手动选项，默认关闭。

- Windows 客户端打开原站后，可共享原站画面和声音；其他成员无需登录提供方的账号。登录状态保留在提供方，画质受原站权限、编码、设备和上行带宽影响。
- 打开本地视频文件即可向房间实时提供画面和声音，无需完整上传或缓存；文件提供者需保持在线。格式支持取决于设备解码器，推荐 H.264/AAC MP4。
- 聊天图片最大 20 MiB，GIF 保留原图与动画。图片使用独立 HTTP 附件传输，不进入同步消息；单房间最多 64 MiB，随聊天过期或房间清理删除。
- 精简界面文案，常用说明移到悬停或折叠帮助。
- Windows 安装版接入 GitHub Releases 更新；Android 应用内下载并校验更新，安装由系统确认，保持相同包名和发布签名。

下载 `VideoSreeeen-Setup.exe` 获取 Windows 安装版（支持后续应用内更新）；`VideoSreeeen 0.4.0.exe` 为便携版。Android 使用 `VideoSreeeen-Android.apk`。SHA-256 见 `SHA256SUMS.txt`。

首次正式 APK 使用独立固定签名，不能覆盖旧的 debug 签名 APK；请勿为切换签名擅自卸载有数据的应用。苹果设备使用 [网页版](https://videosreeeen.pages.dev)。

P2P 默认仅配置 STUN，不启用付费 TURN；受网络限制无法直连时，可使用链接同步。Android 真机、Safari/iOS 接收及跨运营商长期播放尚未验收，不能把桌面浏览器测试视为这些设备已经通过。Windows 安装包尚未取得 Authenticode 证书。

源码与许可证：GPL-3.0-only，[对应仓库](https://github.com/BorderArea01/VideoSreeeen)。
