# 稀饭 AL 新番线路共同播放

2026-10-20。用户提交 `https://next.xifanacg.com/anime/3434/play/203799?source=AL`，界面提示仅支持 xfy2。原因是网页识别入口只接受 `source=xfy2`，并固定请求线路 5；AL 在读取播放接口前即被拒绝。

## 调查与实现

- 在全新浏览器资料中访问用户提供的原站页面，观察原站正常发出的公开 `issue-web-playback` 请求：`action=fallback`、`episode_id=203799`、`source_id=1`。响应包含相同番剧、剧集和 `source_code=AL`，视频位于既有 `play.xfvod.pro:8088` CDN。
- 按原站实际映射支持 xfy2 → 5、AL → 1，不自动改换用户线路。保留匿名跨域读取、无 Cookie、无房间身份、响应大小、取消、过期、剧集、线路和 CDN 校验。未知线路、重复 source 参数、错线路结果继续拒绝。
- 下一集页面元数据白名单允许大写线路代码；仍限定原站路径、单一 source 查询和同番同线路。房间服务不代理视频，首帧检查失败不发布新媒体。
- 网页能力文案更新为 xfy2 / AL。未修改共享画面、登录会话或缓存门槛。

## 本地实播证据

`npm run verify` 通过：62 项测试、格式、构建、Worker 类型检查和部署 dry-run。AL 用例检查了真实线路请求格式、错线路、重复 source 与未知线路拒绝；下一集用例检查 AL 路径白名单与不允许串线。

在受控入口运行：

```powershell
$env:VS_TEST_DIRECT_MEDIA='1'
$env:VS_TEST_NEXT='1'
$env:VS_TEST_RECOVERY='1'
& ./scripts/controlled.ps1 -File node.exe -Arguments @('--import','tsx','scripts/site-source-check.ts','https://next.xifanacg.com/anime/3434/play/203799?source=AL') -AllowGameThisRun -MinFreeMiB 0
```

测试使用两份独立 Edge 浏览器资料、本地真实房间服务和真实原站播放接口；仅将本地 `/config` 的 `mediaRelay` 设为 false，以核验与 Cloudflare 相同的视频直连方式。未拦截或替换成功路径的视频请求，两端 `currentSrc` 均为原 CDN，未走 `/media` 视频代理、屏幕采集或转码。

| 项目                     | 实际结果                                               |
| ------------------------ | ------------------------------------------------------ |
| 来源识别与首帧           | 约 7 秒后发布                                          |
| 双端解码                 | 1920×1080；199 / 168 帧；音频解码 212432 / 188128 字节 |
| 原视频时长               | 1708.352 秒                                            |
| 播放中跳到 30 秒         | 无需暂停再播放，两端继续出帧                           |
| 观众断网 3.5 秒后恢复    | 无需房间暂停再播放，继续出帧                           |
| 暂停、进度、倍速         | 两端暂停于 5 秒、1.25 倍速，与权威房间状态一致         |
| 取消、接口失败、首帧失败 | 保留当前视频，不发布迟到或无法播放的结果               |
| 下一集                   | 原站给出 `203800?source=AL`，两端换片并继续解码        |
| 页面与房间错误           | 无                                                     |

同样以视频直连方式回归原 `151/play/1986?source=xfy2`：两端仍为 1920×1080 并解码音频，播放中拖动、暂停于 5 秒、1.25 倍速、失败保留当前视频及真实下一集 `1987?source=xfy2` 均通过。

本地脱敏运行摘要保存在忽略目录 `.local/xifan-al-playback-local-evidence.json`，不提交原始站点响应、临时视频地址或视频文件。上述为本地开发构建验收，随后按用户要求部署并完成以下公网复验。

## 2026-10-20 正式入口部署与复验

用户明确要求“部署，继续完善”。沿用已授权账号与既有资源，更新 Worker 和 Pages，未升级付费、未启用 TURN、未修改其他项目或安装设备。

- 正式入口：[videosreeeen.pages.dev](https://videosreeeen.pages.dev)。
- 运行时代码提交：`b72aabbe04d3f0ab3d7943f8ee8338bcf4214feb`，已推送 GitHub。
- Worker 版本：`87f3a963-2397-4f56-83ef-c4f8b6eb56f5`。
- Pages 部署：`d177395c-9c63-4525-8631-6a94f3c691fc`，元数据对应上述提交；`WATCH` Service Binding 仍连接同一个 `videosreeeen` Worker。
- 活跃脚本：`assets/index-DJE48tsw.js`，SHA-256 `a1ab1d741628e3679f8c7a272c9d5227e7cd20471938b10fd5b0d5e95e39ac12`。
- 正式域名的 HTML、活跃 JavaScript 与 CSS 和本地构建逐字节一致；健康检查仍为 `0.4.3`。这是网页修订，没有发布新的 Windows / Android 安装包或 Release。

使用 `VS_PUBLIC_URL=https://videosreeeen.pages.dev`，再次运行同一 AL 双端验收。这次直接连接正式 Pages / Worker 房间服务，不再替换 `/config`，也未代理视频或替换原站成功响应：

| 项目           | 正式入口结果                                                  |
| -------------- | ------------------------------------------------------------- |
| 识别与首帧     | 5520 ms 后发布                                                |
| 双端画面与音频 | 原 CDN 1920×1080，237 / 168 帧，音频解码 248380 / 183609 字节 |
| 时间线控制     | 播放中拖到 30 秒继续出帧；暂停、5 秒、1.25 倍速两端一致       |
| 断网恢复       | 观众网络中断 3.5 秒后自动继续出帧                             |
| 下一集         | 正确读取同番同线路 `203800?source=AL`，两端继续解码           |
| 取消和失败     | 取消识别、取消下一集、接口失败及无法加载首帧均保留当前视频    |
| 页面与房间错误 | 无                                                            |

正式入口 `test:playback-modes` 同时通过：两端实际解码 CC0 960 像素示例视频，暂停、1 秒进度与 1.25 倍速真实生效；输入面板切换和不支持的页面不替换当前媒体，键盘导航、390px 手机视口无溢出。

正式入口 `test:broadcast-relay` 回归通过：测试生成的 1280×720 画面与音频经既有 WebSocket 视频通道接收，未启动视频 WebRTC；首播约 6.7 秒，晚加入和离开不重启已有编码，提供者重连、切换流畅画质及停止清理均通过。观众本机静音和全屏正常，实时画面不显示虚假进度、暂停或倍速；连续 6 秒采样均继续出帧，无页面错误。验收脚本同步改为显式选择共享画面，避免依赖已改变的默认面板。

公网脱敏摘要保存在忽略目录 `.local/xifan-al-playback-public-evidence.json` 与 `.local/public-web-source-evidence.json`。以上仍是同一电脑上两份独立浏览器资料的公网服务验收，未完成异地网络、Android / iOS 真机或 B 站登录后高清验收。

随后用户反馈 Android Edge 无法播放同一 AL 视频，实际 HEVC 编码、加载波动、本机恢复与后续部署记录见 [手机播放失败记录](verification-mobile-source.md)。此用户现场失败不因上述电脑实播通过而被排除。
