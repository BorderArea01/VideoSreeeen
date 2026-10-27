# 0.4.4 · B 站共同播放与网页观众支持

**房主使用 Windows 客户端，朋友只打开网页，就能共同观看受支持的 B 站公开视频。** 不需要每位观众安装客户端或登录 B 站。

## 下载与开始使用

| 平台              | 下载                                                                                                            | 使用方式                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Windows x64       | [安装版](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.4/VideoSreeeen-Setup.exe)          | 安装后运行，支持应用内检查与下载更新           |
| Windows x64       | [便携版](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.4/VideoSreeeen-Portable-0.4.4.exe) | 直接运行；后续更新请下载新版或切换安装版       |
| Android 8.0+      | [Android APK](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.4/VideoSreeeen-Android.apk)   | 安装后运行；同签名正式版可覆盖更新，需系统确认 |
| 浏览器 / 苹果设备 | [打开网页版](https://videosreeeen.pages.dev)                                                                    | 无需安装，打开完整邀请链接即可加入             |

[文件校验和 SHA256SUMS.txt](https://github.com/BorderArea01/VideoSreeeen/releases/download/v0.4.4/SHA256SUMS.txt) · [使用说明](https://github.com/BorderArea01/VideoSreeeen#readme) · [反馈问题](https://github.com/BorderArea01/VideoSreeeen/issues/new/choose)

## 这一版更新了什么

- **B 站游客兼容共同播放**：Windows 房主在“共同播放”中粘贴公开 BV 页面，默认获取游客可看的 MP4。每位成员直接从原 CDN 加载视频，同步播放、暂停、进度与倍速，不需要共享屏幕或重新编码。
- **保留原站播放方式**：展开“原站与视频源”，取消“B 站优先兼容网页观众”后，可继续使用客户端原站播放器和各自的本机登录态。
- **换片先检查首帧**：识别成功且本机能够加载画面后才替换房间视频；取消、超时或加载失败保留当前影片，不读取或上传账号 Cookie。
- **安装包跟进网页功能**：包含房间语音与设备选择、视频音量与人声优先、网页全屏、进度预览与精细定位、固定高度聊天室和粘贴截图、刷新恢复成员身份等改进。

## B 站怎么一起看

1. 房主使用 Windows 0.4.4 创建房间，选择“共同播放”，粘贴公开的 `bilibili.com/video/BV…` 链接。
2. 保持默认的游客兼容选项，等待识别并加载首帧。
3. 将完整邀请链接发给朋友，对方用浏览器加入即可观看，无需另行登录 B 站。

**画质与兼容范围**：已实际验证游客 640×360 画面和音频，不承诺免登录 1080p，也不共享房主的登录或付费权限。现有公共服务尚不支持全员纯网页发起 B 站播放；请由 Windows 房主取源。喜番 xfy2 / AL / xfxf1、蜜柑实验线路及视频直链继续保留，具体范围见 README。

## 下载恢复与验证

2026-10-27 已复验 GitHub 仓库、Release 页面和全部 7 个发行资产的匿名访问；Windows 安装包、便携版与 Android APK 均完成实际下载和 SHA-256 核对，Windows / Android 更新元数据也通过一致性检查。此前的公开访问 404 提示已撤下。

实际打包的 Windows 0.4.4 已成功通过 GitHub 公共源检查更新，返回“当前为最新版”；本轮没有执行覆盖安装。

Windows 打包客户端与网页观众的公网房间实播已验证播放、暂停、跳转、倍速和本机重试。Android 构建、Lint 和固定签名检查通过；Android 真机、Safari / iOS、登录后高清及真实旧版本覆盖安装仍待分别验收。没有启用收费产品。

网页入口：[videosreeeen.pages.dev](https://videosreeeen.pages.dev) · 许可证：GPL-3.0-only。
