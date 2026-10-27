# 0.4.5 B 站高清取源接入

2026-10-27，用户要求把已验证的高清源接入现有视频链接入口。沿用已接受的 Windows 房主取源、朋友通过网页观看方案。ZNote 仅作为此前只读研究与验证参照，不是运行时依赖；本次未修改 ZNote。

## 实现

- Windows 默认账号高清源。主进程使用 `persist:sites` 原站会话与受限 Electron 网络读取，正常请求官方登录状态、视频元数据与 `qn=80&fnval=16`。不读取或导出 Cookie 值，不导入系统浏览器会话，不向房间暴露账号信息。
- 首次缺少登录态时，原链接旁显示“登录 B 站并继续”。用户主动打开官方窗口，关闭后继续原链接；换房、离开、换输入或影片变化会取消旧任务。账号仍由原站管理，不自动开登录窗口循环重试。
- 限定同 BV / 分 P、完整时长、非预览和非 DRM；仅选原站签发的有效 AVC 720p / 1080p 与 AAC。没有高清轨道就报错，游客 MP4 保留为手动选项。
- 音视频分别检查本机实际加载与时长后才发布房间媒体。新 `bilibiliDirect` 来源标记让 Windows 和浏览器直接从原 CDN 播放，不打开原站视图；即使 Node 自建后端开启普通媒体代理，此来源仍直连原 CDN。
- 本机刷新更新两条轨道，不修改房间播放版本或缓存代次。仅提供者使用本机权限重新识别，观众不被要求登录。
- 原匿名云端白名单未扩大；没有加入 Cookie 上传、扩展、原站视频代理、试看参数或收费产品。

## 验证分层

**真实 B 站高清源**：此前同日针对 `BV1R6xN66Exx`，使用用户已登录浏览器的正常请求，取得完整 AVC 1080p / AAC。正式公网房间的两位独立网页成员均解码 1920×1080、有音频解码统计，播放、暂停、播放中拖到 30 秒通过。该证据见[真实账号取源复验](verification-bilibili-authorized-source.md)。当时借用了 ZNote 扩展页面的跨域权限，不能据此称客户端新登录流程已真实验收。

**原生入口隔离验收**：`scripts/bilibili-account-check.ts` 在新建客户端配置与独立观众浏览器中，使用合成登录状态、受限 API 响应与本机生成的 70 秒 1080p AVC / AAC 测试片，验证默认高清、缺少登录不降级、关闭官方窗口继续原链接、双端实际解码、播放中跳转后持续出帧、暂停、坏音轨保留原片、观众重试不写房间和取消识别保片。媒体响应实现真实范围读取；没有修改播放器去迁就测试。合成音频保持静音，不代表扬声器听感验收。

**实际网络条件**：新建未登录原站会话，通过真实 Electron 网络读取访问 B 站官方接口，正常返回未登录状态，并产生可识别的登录条件；未使用 Cookie 值或伪造已登录结果。真实账号在此新客户端会话登录后的完整链路仍待验收，不冒充已验证。

**回归与构建**：`npm run verify` 的 97 项测试、格式、TypeScript、前端 / Node 构建、Worker 类型检查和 dry-run 通过。官方账号窗口与隔离会话跨重启测试通过；原播放方式双浏览器播放、暂停、跳转、倍速与切换保片通过。真实 B 站游客兼容路径的 Windows / 独立网页实播仍通过，实际为 640×360，不作为本次高清证据。

## 可重复验收

安装开发依赖并完成 `npm run build`，本机准备 FFmpeg（或通过 `VS_FFMPEG` 指向已有程序），串行执行：

```powershell
& ./scripts/controlled.ps1 -File node.exe -Arguments @('scripts/bilibili-account-fixture.mjs') -AllowGameThisRun -MinFreeMiB 0
```

脚本生成自己的测试片，不下载原站视频、不使用真实账号，结果写入忽略目录 `.local/bilibili-account-native-evidence.json`。设置 `VS_PACKAGED_EXE` 可使用实际打包程序；设置 `VS_PUBLIC_URL` 可测试已部署的公共房间。测试始终隔离资料、保持静音，失败以非零退出码结束。真实账号 / CDN 验收需单独提供新鲜的正常取源结果至检查脚本标准输入，不把签发地址或凭据写入参数、仓库或日志。

## 产物

2026-10-28：Windows 安装版、便携版与 Android 发布 APK 构建通过，Android Release Lint 通过。Windows ASAR 的主程序、新取源模块、官方登录模块、前端 JS / CSS 与 Node 后端逐字节匹配工作区构建。Android 为 `versionName=0.4.5` / `versionCode=10`，沿用证书 SHA-256 `71d21f595ea8306871b55961ff965c4b72cabe80b9ec2915f6bee9f3290978ba`。设备均未安装本次 APK，未改变任何设备网络或 EasyTier。

Windows 安装包 SHA-256：`15ce90c7ea20ed8a0e717e323a9b2cb7e7744a0458e589f8aab70c07cd54523c`；Android APK：`f8a32a6daf776440489a59400372812dbfb84482cdf21fb479c870ee9a8a71a5`。便携版：`05d6b5ae1f6bc16d3c28a8ae41e4eb667197156b8a206f4cca23f44e736c6f40`。

## 公网部署

2026-10-28，Cloudflare 登录失效后由用户在官方页面重新授权，复核仍为原已授权账号。更新原有 Worker / Pages，没有启用收费产品。运行时代码提交 `5a8e8a0bb35b89a16c17b86c22f44275864d8184`：

- Worker 版本 `b27dd88a-5a7b-4241-8ff8-1c1475cbe114`，仍使用同一 `ROOMS` Durable Object。
- Pages 部署 [24e2279f](https://24e2279f.videosreeeen.pages.dev)，正式入口 [videosreeeen.pages.dev](https://videosreeeen.pages.dev)。Worker 与 Pages `/healthz` 均返回 0.4.5；服务仍关闭原站视频代理。
- 线上 HTML / JS / CSS 与本机构建逐字节一致。`index-3rc7-xrP.js` SHA-256 为 `a485b58f4f7cef544494241c78f82c4f37bbd8747ff8c69a6395201450f5e6c3`；`index-CIXhGdog.css` 为 `2b8fe218eda01f0e0c48a2b1e720961f986bb5fb1c1aa49a742c06ce5dd35009`。
- 实际打包的 Windows 与独立网页观众使用正式公网房间，通过上述合成登录 / 测试片流程。两端均解码 1920×1080，播放中跳到 30 秒后仍持续出帧、AAC 解码；暂停、坏音轨保片、观众重试不发布及取消识别均通过。这个检查验证公网协议与成品入口，不代表真实账号登录或跨地域 CDN 实播已覆盖。

## 公开发行与更新

2026-10-28 已发布 [v0.4.5](https://github.com/BorderArea01/VideoSreeeen/releases/tag/v0.4.5)，标签目标 `390d48ab590715c2884627bbae7528fde59b55ae`，与上述运行时代码一致，另包含部署验证文档。先上传草稿并核对全部资产大小与服务端 SHA-256，再公开；未覆盖旧版资产。

匿名访问仓库、Release 和全部 7 个发行文件通过，实际完整读取并核对摘要：Windows 安装包 111,138,361 字节，便携版 110,971,128 字节，Android APK 2,021,517 字节；更新清单、blockmap 和校验文件均一致。Windows `latest.yml` 的安装包 SHA-512 / 大小、Android `update.json` 的版本码 / SHA-256 / 大小与成品匹配。实际打包 Windows 0.4.5 使用隔离资料，从 GitHub 公共更新源检查返回“当前为最新版”；没有覆盖安装。

本次真实账号在新客户端首次登录后的完整实播、Android / Safari 真机、跨地域与长片验收仍未完成。不得将合成登录 / 测试片、公网房间可用或更新器检查成功表述为这些项目已验收。
