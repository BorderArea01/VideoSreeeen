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

部署与正式版本核对结果在完成后追加；前述开发壳验证不代表已发布安装包或异地用户真机验收。
