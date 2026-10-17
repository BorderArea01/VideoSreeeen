# 参与 VideoSreeeen

无需懂代码也能反馈：[提交使用问题](https://github.com/BorderArea01/VideoSreeeen/issues/new/choose)。请说明入口、版本、复现步骤和实际提示，不要附带邀请凭证、Cookie 或访问令牌。兼容站点的问题请提供可公开访问的页面。

开发环境与构建步骤见 [README](README.md)，部署见 [Cloudflare 文档](docs/cloudflare.md)。浏览器开发可同时运行 `npm run dev` 和 `npm run dev:ui`；Windows / Android 复用同一前端，苹果设备走浏览器。

提交改动前运行 `npm run verify`。涉及 Workers 房间持久化时运行 `npm run test:worker`；涉及加入和邀请时运行 `npm run test:onboarding`；涉及文件互传时运行 `npm run test:p2p`。这些界面验收脚本目前使用 Windows 上的 Edge，不能声称在其他系统上已运行。该维护工作站必须使用 README 中的受控入口并遵守游戏与内存限制。

保留服务器对房间状态的唯一裁决、全员缓存内容指纹门槛、聊天和真实成员延迟。原站不能获取特权桥接；不要绕过原站登录、付费或 DRM。缓存只清理本应用创建的数据。改动协议时同时考虑客户端、Node 服务和 Workers 后端。

PR 请写明用户遇到的问题、改后的行为、已运行的检查和剩余限制。播放器 URL 被识别不等于完成实播，模拟环境通过不等于真机通过；记录应遵守 [验证记录](docs/verification.md) 的区分。

新贡献按本项目 GPL-3.0-only 提供。引用其他项目时保留其许可与出处，并更新 [THIRD_PARTY.md](THIRD_PARTY.md)。不要提交安装包、下载的视频、临时邀请、认证文件、签名私钥或本机日志。

当前尚无公开客户端发行版，GitHub Actions 账号权限也尚未恢复。维护者发布客户端前，应提供对应提交、构建命令、SHA-256、实际验证范围和稳定的 Android 发行签名；不要把未运行的工作流当作发行成功。
