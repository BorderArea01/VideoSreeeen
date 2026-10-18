# B 站、蜜柑共同播放与客户端登录复验

2026-10-19。保留稀饭已通过的网页路径，分别核对原站共同播放与浏览器接收。测试使用独立应用资料目录，不读取真实账号、系统浏览器资料或用户 Cookie，不安装到 Android 设备。

## 实现

- B 站现有播放器不再保证暴露 `window.__playinfo__`。桥接增加正常公开播放器 `player.getMediaInfo().playUrl` 回退，保留原站已签发地址；音视频分隔只匹配逗号后跟 HTTP(S) 地址，不拆坏签名查询中的逗号。未修改登录、付费、签名或 CDN 访问规则。
- 修复首个人工操作丢失：空闲 seq=0 样本同样初始化事件基线，首个拖动不能作为初始化事件被吞掉；切片、导航、计数器重置与重复事件分别处理。
- 原站新窗口导航按站点收紧，防止站外弹窗替换播放器；B 站正常 HTTPS 登录域名保持可用。该项是导航保护，不将它描述为蜜柑失败的已证实根因。
- 设置中增加原站登录入口。Windows 使用 `persist:sites` 独立原站 session 的无 preload 登录窗口；Android 使用无应用桥接的原站 WebView。登录页与原站播放器共享本机站点存储。关闭窗口保存会话并刷新当前 B 站原站，正常登录和退出均由原站处理。不设置 Cookie 导入、复制、导出或服务器托管接口。
- 修正测试方法：当前 Playwright 的 `waitForFunction` 同步判断 predicate 的返回值，异步原生 IPC 返回的 Promise 会被当作真值而提前结束等待。改为测试进程逐次 await IPC，再判定真实样本；既有原站 fixture 脚本也同步修订。初期蜜柑“双客户端不可用”判断因此撤回，不能把测试脚本的提前判断算作产品故障。
- 测试诊断里嵌套函数经转译引用 `__name`，曾触发 Electron 主进程错误弹窗。该段诊断已移除，正式实现没有该引用；后续真实双客户端运行通过。

## 真实播放结果

测试链接：B 站 `https://www.bilibili.com/video/BV13Aa66LEAW/`，蜜柑 `https://www.mgnacg.com/bangumi/193-3-17/`。

| 路径                         | 结果与边界                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B 站双 Windows 原站共同播放  | 本地房间服务与两个隔离 Windows 壳通过；游客 640×360，两端解码 185 / 106 帧与音轨；暂停、5 秒、1.25 倍速稳定一致。通过原站 DOM 人工操作路径拖到 8 秒，权威状态与两端播放器均同步。没有画面捕获、完整缓存或真实账号。          |
| 蜜柑双 Windows 原站共同播放  | 相同环境通过；1920×1080，两端解码 200 / 197 帧与音轨，同样通过暂停、5 秒、1.25 倍速、原站拖到 8 秒。准备约 14.1 秒。                                                                                                         |
| 蜜柑 Windows 提供源 → 浏览器 | 正式房间服务测试通过；浏览器直接从 `r2.jzacg.com` 解码 1920×1080、154 帧与音轨，暂停、5 秒、1.25 倍速与原站及权威状态一致。没有完整缓存或画面捕获。                                                                          |
| B 站 Windows 提供源 → 浏览器 | 已识别 DASH，浏览器未播放。原站正常签发的 AVC / AAC HTTPS 地址在跨站播放器请求中返回 CDN HTTP 403；调整 CORS / Referer 的有限正常请求检查也未通过。不能宣称 Cookie 本地保存会修好此路径。                                    |
| B 站、蜜柑纯网页             | B 站正常 API 的 CORS 许可限定 B 站自身页面；蜜柑 Worker 页面识别仍可能 HTTP 403 / 520 / 超时，保持实验支持。                                                                                                                 |
| 本地会话保存                 | 实际 B 站官方扫码登录页加载成功；仅用 `.invalid` 域的合成 Cookie 验证原站 session 与房间 session 分离、应用重启保留、登录窗口没有 desktop / VSNative 桥接。没有替用户登录，不等同于登录后高清、会员视频或 Android 真机通过。 |

初步证据为 `.local/native-pair-evidence.json`、`.local/native-real-sites-evidence.json`、`.local/bili-media-check-evidence.json`、`.local/site-account-evidence.json`；不提交原始响应、临时视频签名或会话资料。

## 重复验收

通过项目受控入口串行执行 `npm run verify`、`npm run test:site-account`、`npm run test:native-origin`。原站脚本使用新建的隔离资料目录，默认本地 Node 房间服务；设置 `VS_PUBLIC_URL=https://videosreeeen.pages.dev` 可改用正式网页与房间服务，部署后再核对运行版本。可在 `test:native-origin -- bilibili` 或 `-- mgn` 单独选站。

登录使用 [Electron 原站会话 Cookie 存储](https://www.electronjs.org/docs/latest/api/cookies) 与 [Android CookieManager](https://developer.android.com/reference/android/webkit/CookieManager) 的标准持久化。原站播放器行为以实际正常页面验证为准，不根据 metadata 200 判断播放成功。

## 0.4.1 构建与产物

- `npm run verify` 通过：50 项测试、格式、前端 / Node / Worker 类型与构建、Worker dry-run；随后修订的测试脚本另行通过类型检查。
- Windows NSIS 安装版、便携版构建完成；打包后的原站登录页与重启本地会话保留验证通过，使用 `--user-data-dir` 指定新建目录并在测试前核对应用实际资料路径，未操作用户原有资料。打包播放器、完整落盘缓存播放与清理、内置服务退出清理、便携包装器启动通过。
- 更新器读取 0.4.1 元数据并下载实际 111032758 字节安装包，SHA-256 与成品一致；损坏更新被拒绝，没有执行安装。
- Android `assembleRelease` 与 `lintRelease` 通过，0 错误 / 4 警告。包名不变，versionCode 6 / versionName 0.4.1，minSdk 26 / targetSdk 35。apksigner 通过，证书 SHA-256 `71d21f595ea8306871b55961ff965c4b72cabe80b9ec2915f6bee9f3290978ba`，与 0.4.0 相同；未安装设备，未验证 Android 登录后播放。
- 安装版 SHA-256 `d83d948d8411219f079f13fd976f7b41a9465a76db98a451dfdd598abba8a076`；便携版 `8eb3a518aee46ff23a0600096af2ccf896bcbe372c2c4388fc9cf6eb94c8725a`；APK `98b08c6092d5950403404c5091abefcdd6622eb966bfa60b04ff44d8f4413974`。

## 正式服务与打包客户端复验

2026-10-19 03:13（北京时间）核对正式网页与房间服务：

- 运行时提交 `30f5988370340d7310189aa5f747994995f536dc`，健康版本 0.4.1。
- Worker `b3ea2141-b33a-4be7-a88b-793f3469e738`；Pages `6e40849c-a3c9-417e-8a71-004531aedfe8`。
- 活跃 JS `index-CFEmENmr.js`，SHA-256 `046e630fed35bc9d4713003fe2c5d8ffe3e41c57a0c61859af52288398dd8c75`；CSS `index-alx5V5Wp.css`，SHA-256 `51df51c3be268a41c3eebe70a458311e51f53ce150153a1097fc826abb204c18`。在线 HTML、JS、CSS 与构建逐字节相同，Pages 提交与运行时提交一致。
- 两个**打包后的 0.4.1 Windows 应用**使用新的隔离资料目录、正常系统网络、正式房间服务，通过 B 站和蜜柑共同播放。B 站游客两端 640×360、105 / 98 帧与音轨，准备约 4.8 秒；蜜柑两端 1920×1080、288 / 289 帧与音轨，准备约 14.9 秒。两站均在暂停、5 秒、1.25 倍速稳定保持后，再验证原站 DOM 人工操作路径拖到 8 秒，权威状态与两端播放器均跟随。证据 `.local/native-origin-evidence.json`。
- 正式网页稀饭回归通过：两个存储隔离浏览器均直接从 `play.xfvod.pro` 解码 1920×1080 与音轨，准备约 4.9 秒；暂停、5 秒、1.25 倍速及权威状态一致。取消、失败和接口成功但媒体不可播均不替换当前影片；没有页面错误，没有画面捕获或原站 HTTP 视频代理。证据 `.local/xifan-playback-evidence.json`。

客户端版本与校验和对应 [v0.4.1 发布入口](https://github.com/BorderArea01/VideoSreeeen/releases/tag/v0.4.1)；上传流程先保留草稿，逐项核对 GitHub 返回的 SHA-256 和字节数后才发布，不覆盖旧版本。运行时代码对应上述部署提交，后续验证记录提交不改变已构建运行时。

### 发布与公开下载边界

GitHub 认证 API 已核对 v0.4.1 为 latest、非草稿，七个附件字节数与 SHA-256 均匹配本地成品，发布对应提交 `3bedd446ecfff6705a6e3bd355d64dd2f4f1d766`。但**未登录访问仓库、latest release API、0.4.1 和旧版 0.4.0 的 update.json 均返回 404**；通过现有 Clash 代理和不走代理分别复验结果相同，独立网页读取仓库也为 404。认证 API 显示仓库 PUBLIC，当前证据不能确定 GitHub 侧拒绝匿名访问的具体原因。

因此只能声明发布已创建、附件在认证 API 下可核对，不能声明公开下载与在线自动更新已可用，也不将账户权限问题归咎于用户 Cookie 或本地播放器。保留 `artifacts/windows/VideoSreeeen-Setup.exe`、`artifacts/android/VideoSreeeen-Android.apk` 供本机取用；没有向客户端添加 GitHub 令牌或扩大付费授权。此前本地更新器测试证明元数据下载和校验逻辑，不代替这次公开分发的失败结果。

没有使用真实登录、画面捕获、完整缓存或收费产品；不能将同机独立应用加正式公网房间服务验收描述为用户异地、登录后高清、Android 或 Safari 真机通过。
