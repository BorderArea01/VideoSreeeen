# B 站网页共同播放

2026-10-25，用户要求朋友无需安装客户端、无需逐人跳转登录即可参与共同播放。

## 实现边界

此前尝试的是桌面 DASH 轨道，在应用域名下遭到跨域 / ORB 阻止。本次使用官方公开 `api.bilibili.com/x/web-interface/view` 与 `/x/player/playurl` 的 HTML5 MP4 模式（`qn=32&platform=html5`）。实际返回质量由原站决定，本次为 quality 16、640×360；没有把请求的 qn 或菜单列出的 1080p 当作实际画质。

房间服务只识别受限的 BV / 分 P 元数据，视频从原 bilivideo.com CDN 直接加载；不启用视频代理，不发送用户 Cookie、房间凭据、App 身份或试看参数。拒绝付费权限、预览、DRM、时长不完整、多段、异常来源与临近过期地址。提供者能加载首帧后才发布媒体，取消、迟到或加载失败保留原影片。下一分 P 继续使用既有取消与换片裁决；本机重试可重新获取同视频公开地址，不发布房间换片、控制或缓存代次。

## 可重复验证

通过受控入口串行运行 `npm run verify`、`npm run test:site-source -- https://www.bilibili.com/video/BV1TuHM6REHk/`。本地验证设置 `VS_TEST_DIRECT_MEDIA=1`，线上验证设置 `VS_PUBLIC_URL=https://videosreeeen.pages.dev`；需要本机代理时设置 `VS_TEST_PROXY`。测试浏览器使用隔离资料、静音输出，不复用用户账号。

本地真实公开源已通过：两端独立解码 640×360、实际 AAC 音频字节，原 CDN HTTP 206，播放中跳到 30 秒后持续解码，无需暂停再播放；房主暂停、观众跳到 5 秒、1.25 倍速经服务器裁决后双端一致。取消、识别失败、首帧失败不替换房间媒体。安全单测覆盖分 P、预览、付费、完整时长、签名期限、未知 CDN、接口白名单及成员授权。

## Cloudflare 阻断与 Windows 本机取源

首次部署提交 `2c76af5` 到现有 Worker / Pages 后，线上真实房间取源返回 HTTP 412；原站页面与公开 API 均被此云端出口拒绝。正常浏览器跨域 fetch 不可读，播放接口没有提供可用的 JSONP 路径。没有伪造登录、绕过风控或启用原站视频代理。先前本地成功不能作为线上纯网页成功。

用户确认接受 Windows 房主取源、朋友使用网页。因此新增仅供应用主窗口调用的 `publicBilibili` IPC：在 Windows 本机匿名请求固定白名单 API，限定响应大小、12 秒超时、单请求与显式取消。原站页面没有该桥接。通过 `source.bilibiliHtml5` 标记让新客户端直接播放 MP4，不再打开原站窗口；网页观众直接读取同一 CDN 地址。

Windows 默认启用此游客兼容路径；高级原站选项可取消，继续原有本机登录和原站播放。兼容路径隐藏无效的登录与提取按钮。本机重试、下一分 P 使用本机接口；网页观众本机重试复用当前地址，不再反复调用被拒绝的云端接口。源地址失效需要房主重新提供。

本地真实 Electron 房主 + 隔离 Edge 观众已通过：原 CDN HTTP 206、双方 640×360 与 AAC、播放 / 暂停 / 30 秒播放中跳转 / 5 秒暂停跳转 / 1.25 倍速；10 秒内双端持续出帧且时间推进约 10 秒。观众本机重试不发房间控制或换片，两端无 SESSDATA；本机 IPC 取消、界面取消与内网 URL 拒绝通过。自建 Node 的双网页另已实播 `BV13Aa66LEAW`（640×360）。运行验收增加 `VS_NATIVE_BILI=1`。

## 部署与设备范围

线上部署运行时提交 `10248f0718edc03070a7f71be7cc14e7b45c7387`；Worker 版本 `bcbb3b2a-3e16-4e8e-ab53-1cc8c65ba145`，Pages 部署 `ed076179-9863-4c47-b1f1-f8e1160df9f4`，健康版本 0.4.4。正式入口 HTML / JS / CSS 已与本地构建逐字节核对。JS `/assets/index-BaGzc-7U.js` SHA-256 为 `fbb16ba21cbf9f3b32dd18adb91d0601b1c02b650337f55e0fd7d4f32d7a0cb6`；CSS 保持 `374d682f4773193d0e22809b5835f3ce04fadb1a61fd4ea4b5ec4b66c61561b2`。

正式入口实际 Windows 房主 + 独立网页观众已通过上述完整实播：约 2.4 秒发布首帧，两端直接获得同一 B 站 CDN 的 HTTP 206；10 秒观测分别从约 31.36 / 31.37 秒推进到 41.38 / 41.39 秒，持续出帧，控制后均暂停于 5 秒、1.25 倍速，无应用异常。首次测试因窗口退出中断；随后隐藏测试窗口时截图等待不稳定，验收脚本改为后台完成控制测试、截图前短暂显示窗口，重跑全项通过，没有通过放宽播放断言掩盖问题。

`npm run verify` 通过：92 项单测、格式、TypeScript、网页 / Node 构建、Worker 类型与 dry-run。

Windows NSIS 与便携版已生成。使用实际 `win-unpacked/VideoSreeeen.exe`、独立测试资料和 `file:` 前端再次连接正式房间，B 站共同播放全部检查通过：约 1.9 秒发布，双方 640×360 / AAC，暂停、拖动、倍速、本机重试和取消正常。ASAR 内主进程、preload、原站桥接、前端 HTML / JS / CSS、Node 后端均与工作区逐字节一致，包内版本 0.4.4。安装包 SHA-256 `6607f1242cfcdc3fac8c37b77300af322953db6270b189fabd1a0056bc42e2b6`；便携版 `899782b7e7a493dbc79c8d93e6676cea962181289ba451d1c01dcd7dddd5f4d8`。没有执行覆盖安装。

实际打包客户端的 `test:site-account` 也通过：切回原站后“登录 B 站”可打开官方页面，反复点击复用窗口，合成 `.invalid` Cookie 只保存在独立原站会话并跨重启保留；没有使用真实账号，没有恢复已撤回的系统浏览器扫码授权方案。

Android release 构建与 `lintRelease` 通过，版本 0.4.4 / versionCode 9；APK SHA-256 `9ed9f6e5d83ef2cd36135740dae909d9a022b6d59986fd6ef9b64bfe828b6d1b`。本轮只生成 APK，不安装设备。

APK 签名与 0.4.3 相同，内含 HTML / JS / CSS 与部署构建逐字节一致。`test:playback-modes` 直链双端同步、切换输入不换片、未知网站不替换影片、键盘与窄屏回归通过。

GitHub Release `v0.4.4` 已由维护账号发布，标签提交 `f98acbe6e887be35dca8d34d8dc78a8e9f4ed94b`，含 7 个资产（Windows 安装版、便携版、blockmap、latest.yml、Android APK、update.json、SHA256SUMS）。上传前后逐项核对大小和 GitHub 返回的 SHA-256 digest；这不代表匿名下载已恢复。验证后的本机成品同时保留在 `artifacts/release/0.4.4/`。

尚未以真实手机、Safari / iOS 或登录后高清验收；桌面浏览器证据不代替这些设备结论。普通公开接口可能因站点调整或请求限制失效，此时明确报错并保留手动共享画面。未启用付费服务。GitHub 仓库和最新安装包匿名 HEAD 请求仍返回 404，因此不能宣称公开下载或自动更新已经可用。

2026-10-27 补充：上述 GitHub 404 为发布时的历史状态，现已恢复。全部 7 个资产已完成匿名下载和摘要核对，实际 Windows 成品也已成功检查 GitHub 更新源；详见 [公开访问恢复记录](github-access.md)。本轮只更新文档与 Release 正文，没有重新打包或替换发行资产。
