# B 站浏览器视频源助手验证

2026-10-28，用户要求房主安装独立轻量扩展、观众继续使用网页，并删除旧游客低画质与扫码登录流程。当前实现版本 0.4.6，扩展版本 0.1.0。

## 实现与删除范围

- Manifest V3 后台仅向固定 B 站只读接口发起正常带会话请求，复用浏览器登录；不申请 cookies 权限，不读取、导出或上传 Cookie 值。
- 内容脚本仅桥接正式放映厅与回环开发页；校验顶层窗口、来源、请求结构、操作及 BV 页面。后台再次校验调用页与接口白名单，不接受任意 URL 请求。
- 房间媒体仍由原 WebSocket 操作协议发布。两条轨道先通过提供方加载检查；取消、换片、下一分 P 和本机重试保留既有代次及迟到响应保护。
- 已删除游客 MP4 取源函数 / 标记 / 原生 IPC / 低画质菜单，Node 扫码会话服务 / 页面 / 二维码依赖，以及 Windows / Android 专用 B 站登录窗口与桥接。删除对应旧验收脚本，测试改为新扩展实际加载。
- 保留其他站点适配、共同缓存、聊天室、弹幕、语音、共享画面、文件提供及客户端手动原站播放。

## 实际加载与隔离自动验收

在临时 Edge 配置文件中加载实际构建的扩展；另一独立浏览器关闭扩展，以网页观众身份加入。仅使用合成 B 站接口和 FFmpeg 生成的 70 秒测试片，未使用真实账号、原站视频或替代扫码。

已通过：无扩展提示、未登录仅检查登录状态、同一链接重试取源、双端实际解码 1920×1080 / AAC、播放暂停与播放中跳转、下一分 P、取消迟到结果不换片、账号失效不替换当前影片。最终合成双端分别 46 / 42 帧，跳转后约 34.8 秒，均有真实音频解码字节。此项不等于真实 B 站账号或跨网验收。

完整 `npm run verify` 通过 97 项测试、格式检查、TypeScript、前端 / Node 构建、Worker 类型检查与 dry-run。Worker 集成检查通过休眠恢复、图片、语音及画面转发；普通共同播放回归通过双向暂停、进度、倍速、模式切换和手机布局，未出现页面异常。

可重复检查：

```powershell
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','verify') -AllowGameThisRun -MinFreeMiB 0
$env:VS_FFMPEG = '你的 ffmpeg.exe 绝对路径'
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','test:extension') -AllowGameThisRun -MinFreeMiB 0
```

证据仅在忽略目录 `.local/extension-evidence.json`，不记录签发地址、房间凭据或账号数据。

## 当前浏览器安装与真实账号

用户明确要求安装到当前已打开的浏览器。已通过 Edge 扩展管理页加载本项目 `artifacts/browser-extension`，页面显示“VideoSreeeen · 视频源助手 0.1.0”已启用；未切换其他扩展或读取浏览器配置文件。开发人员模式原本已开启。

使用用户当前 Edge 的正常登录、我们自己的独立扩展、真实 `BV1R6xN66Exx` 完成双端网页实播，未借用 ZNote 取源权限、未导出 Cookie。房主与独立无扩展浏览器分别实际解码 1920×1080，235 / 260 帧，音频解码 93,956 / 90,824 字节；播放中跳至 30 秒后两端继续出帧，暂停同步通过。测试输出静音，音频字节不等于扬声器听感验收。临时房间与本机服务已关闭。

排查发现原站实际返回的 MCDN 主源使用 **8082 端口**，旧校验只接受 4483，错误丢弃主源，选中要求原站 Referer 的常规备源。该备源无原站 Referer 返回 403 / text/html，浏览器显示 `ERR_BLOCKED_BY_ORB`。修正后仅增加已实际观察到的 MCDN HTTPS 8082，并优先使用原站返回的 MCDN 地址；签名不变，不修改成其他 CDN、不伪造原站 Referer、不代理视频。独立观众端使用标准 `no-referrer` 策略，生产页面也采用此策略，避免向媒体源发送放映厅页面地址。真实视频返回 200 / 206 并实际解码，不能以 200 响应单独判断播放成功。

真实证据摘要位于 `.local/extension-real-evidence.json`，仅包含编解码、状态与 CDN 主机，不含签发路径、账号或房间凭据。本次为同机双浏览器经真实互联网 CDN 播放，不代表两地运营商、手机或长片已通过。此前借用 ZNote 的结果仅为历史路线依据，见 [历史真实源验证](verification-bilibili-authorized-source.md)。

## 产物与部署

构建入口已将扩展和 ZIP 纳入 `npm run build`；ZIP 为 `artifacts/VideoSreeeen-SourceHelper.zip`，同一文件进入 `dist/downloads` 供网页下载。ZIP 只包含固定分发文件及 GPL 许可证；未上架扩展商店，安装需一次性加载解压目录。

Windows 安装版与便携版已构建。实际启动打包后的 0.4.6，界面、Node 后端与构建资源逐字节一致；旧登录窗口、游客取源 IPC 与二维码依赖未进入包，旧命令被明确拒绝。Android Release / Lint 通过，versionCode 为 11；APK 网页资源与当前构建逐字节一致，旧网页资源已由 Sync 清除，未安装到设备。

固定 Android 发布证书 SHA-256 仍为 `71d21f595ea8306871b55961ff965c4b72cabe80b9ec2915f6bee9f3290978ba`。产物 SHA-256：

| 文件                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| Windows 安装版                | `1246e3e0df1577dc27d4074ee67b613cad7398f3c977b94efeceb2517683adc9` |
| Windows 便携版                | `d25ad8acdf90ae897ee57faf11707e09e13ccdd5e5696b06562001e3da9128b4` |
| Android APK                   | `5c004b566186c26d2acad6dd9badc89cf0c2c6932fdec0fb3695b0c48188f9a4` |
| 视频源助手 ZIP（18,351 字节） | `78af55d05f30ebf5eaaa943452e0ed8a07fb490522a0d0438a8a9109cf051b2b` |

ZIP 的固定六个文件及 CRC 校验通过。代码提交 `7211752348b8cf516a63b8b7c867653db9c6f26b` 已推送，Windows / Android / 扩展一起发布到 [v0.4.6](https://github.com/BorderArea01/VideoSreeeen/releases/tag/v0.4.6)，原有 v0.4.5 产物未覆盖。手机 / Safari、跨运营商、长片和临时地址过期仍需现场验收。

## 正式部署与公网房间实播

使用原先已授权的 Cloudflare 免费账号与同一房间 Worker；没有升级付费、启用 TURN 或新增取源服务器。Worker 版本为 `907e70eb-1660-485a-939b-d0cbc0672a23`，Pages 部署为 `7875410c`，正式入口 `/healthz` 返回 0.4.6 / cloudflare。Pages 继续通过原 Service Binding 连接同一 Worker，不复制房间状态。

部署后，在用户当前 Edge 的正式网页创建新验收房间，粘贴同一 BV 链接，通过自己的扩展和已有正常登录取源；另一个没有扩展或 B 站登录的独立浏览器从正式邀请加入。**两端均实际解码 1920×1080 / AAC**，分别约 296 / 311 帧、138,514 / 152,879 音频解码字节；播放、跳转至 30 秒后继续出帧、两端暂停通过。房间实际接收 play / seek / pause，未返回控制错误。验收只操作控件可用状态；最初脚本在前一操作确认前触发跳转，被界面保护忽略，调整验收等待后通过，未修改播放器或伪造时间线。双方验收成员均主动离开，用户浏览器保留正式网页。

公网实播证据仅在 `.local/extension-public-evidence.json`，不保存邀请、视频路径或账号信息。正式网页采用正常 no-referrer 策略，观众端没有临时修改请求头或载入其他扩展。网页主脚本 SHA-256 为 `5b470d780d8d8908a0770511998938db1900958fe86d0b288bdae5800f649c93`，CSS 为 `57f9001e5928bab25d1c81c8a04dfbccd21d6d56ab7650d24c32bb9869465963`；扩展公开下载 SHA-256 与上述产物一致。

GitHub Release 的八个文件均已完成匿名完整下载，大小及 SHA-256 与本地发行产物全部一致，包括 Windows 安装版、便携版、blockmap、Android APK、扩展 ZIP、两份更新元数据与校验和。正式网页 HTML、JS、CSS 和扩展 ZIP 的公开下载也与当前构建一致；`/healthz` 返回 0.4.6 / cloudflare，Android 更新清单为 0.4.6 / versionCode 11。下载检查没有使用 GitHub 凭据，证据位于 `.local/extension-download-evidence.json`。初次 Node 下载器的 CDN TLS 连接重置未复现于系统 curl 完整下载，不能据此判断账号被限制。

发布之后，旧标签工作流又触发云端重复构建；Android 在 SDK 准备阶段找不到默认 `tools` 包，未进入应用编译。这不影响已发布并核对过的本地产物。已将客户端工作流改为只接受手动触发、只上传 Actions 产物，并修正 SDK 包列表；保留普通 Verify。没有重跑失败任务、覆盖发行包或移动 v0.4.6 标签。云端修正尚未通过实际云端构建验收，详见 [分发与更新](updates.md)。
