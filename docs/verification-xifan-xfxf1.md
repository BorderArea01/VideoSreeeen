# 稀饭 xfxf1 共同播放

2026-10-21。用户提交 `https://next.xifanacg.com/anime/3434/play/203802?source=xfxf1`，旧适配只有 xfy2 / AL，读取公开播放接口之前便拒绝此线路。

## 原站调查与实现

在独立 Edge 浏览器资料中打开该页面，观察原站自己的公开请求：`issue-web-playback`、`action=fallback`、`episode_id=203802`、`source_id=4`。响应番剧为 3434，候选线路代码为 xfxf1，视频签发入口为 `https://apn.moedot.net` 的 MP4，正常重定向至 `https://bjdownload.pan.wo.cn:30443`。原站能解码 1920×1080。

适配增加 xfxf1 → 4，并为每条线路单独限定 CDN origin。新域名没有扩大 AL / xfy2 的允许范围；继续校验番剧、剧集、线路、期限、HTTPS、端口、格式和响应上限。保留原站签发地址，不猜测或修改签名，不换成其他线路，不传 Cookie、房间身份或授权头。识别仍必须在提供者浏览器加载首帧才可发布。

只增加映射后，真实双端测试发现播放中拖动卡住：浏览器对重定向视频的部分 HTTP 缓存续传收到 400，随后报告 `ERR_BLOCKED_BY_ORB`；相同地址和范围的独立请求可返回 206。关闭页面缓存或增加 preload 没有完整解决。不能把这个现象简单归为视频无法解码，也不能只以首帧成功作为适配通过。

处理限定在浏览器本机：`public-video-sw.js` 只对 `apn.moedot.net` 的匿名视频 GET 使用 `fetch(request, { cache: 'no-store', credentials: 'omit' })`，原样返回 opaque 响应。它不读取内容、不伪造跨域许可、不保存视频、不代理到房间服务器；应用资源、聊天、语音、其他线路和手动缓存下载均不接管。这是浏览器 HTTP 请求策略，**不是共同缓存**。实现依据为 [FetchEvent.respondWith 的 opaque 响应约束](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith) 与 [Request.cache](https://developer.mozilla.org/en-US/docs/Web/API/Request/cache)。

该处理使用 HTTPS / localhost 下的 Service Worker，注册有超时、取消和重试边界。提供者首帧检查及观众播放器都先等待本机接管完成；注册失败不能伪报视频就绪。

同时复现了下一集能换片却不接着播放：初始定位使已经排队的 loadeddata 回调执行时 readyState 又降至 1。新增 canplay / seeked 就绪处理，等初始定位完成后发送一次正常房间播放操作；没有改成后台强制自动播放或绕过房间裁决。

## 自动检查与本地实播

`npm run verify` 通过：83 项测试、格式、TypeScript、网页 / Node 构建、Worker 类型与部署 dry-run。新增测试涵盖线路 4 请求、串线拒绝、分线路 CDN、同线路下一集，以及 Service Worker 的请求范围、原始 Range / opaque 响应保留和无凭据转发。

复现入口：

```powershell
$env:VS_TEST_PROXY='http://127.0.0.1:7897'
$env:VS_TEST_DIRECT_MEDIA='1'
$env:VS_TEST_NEXT='1'
$env:VS_TEST_RECOVERY='1'
& ./scripts/controlled.ps1 -File node.exe -Arguments @('--import','tsx','scripts/site-source-check.ts','https://next.xifanacg.com/anime/3434/play/203802?source=xfxf1') -AllowGameThisRun -MinFreeMiB 0
```

两份独立 Edge 资料、本地真实房间、真实原站 API 和 CDN。仅把本地配置改为与线上相同的视频直连；成功路径不替换原站响应。网络中断使用整个观众 context 的离线开关，包含其 Service Worker。

| 项目           | 本地结果                                                    |
| -------------- | ----------------------------------------------------------- |
| 识别与首帧     | 1358 ms 后发布；两端由本机视频 Worker 接管                  |
| 画面与音频     | 两端 1920×1080，368 / 396 帧，音频解码 396768 / 421048 字节 |
| 原视频时长     | 1681.096083 秒                                              |
| 播放中拖动     | 跳至 30 秒后继续出帧，无需暂停再播放                        |
| 继续观看 10 秒 | 两端新增 255 / 240 帧，时间分别前进 10.62 / 10.02 秒        |
| 网络中断       | 观众断网 3.5 秒后继续出帧，未发送房间暂停                   |
| 权威控制       | 暂停于 5 秒，1.25 倍速，两端与房间一致                      |
| 失败隔离       | 取消识别、接口错误、首帧失败、取消下一集都保留当前媒体      |
| 下一集         | 原站明确给出的 `203803?source=xfxf1`，两端从开头继续解码    |
| 页面与房间错误 | 无                                                          |

脱敏摘要保存在忽略目录 `.local/xifan-xfxf1-playback-local-evidence.json`。没有提交签发链接、原站响应或视频文件。

原有 AL `3434/play/203799?source=AL`、xfy2 `151/play/1986?source=xfy2` 也分别以双端视频直连回归：均解码 1920×1080 与音频，播放中拖动、暂停于 5 秒、1.25 倍速、取消 / 失败保留当前媒体及同线路下一集继续播放通过。两条旧线路的媒体请求没有被新增 Service Worker 接管。

## 正式部署与公网复验

沿用已授权账号和既有资源，更新同一个 Worker 与 Pages，未创建付费产品。上线前保存的回滚基线为 Worker `0ad4275b-9216-4957-bc08-957b8c8188df`、Pages `2eb397fd-a23c-41d5-89b4-616a3dba7de7`；WATCH 绑定仍指向 `videosreeeen`。

- 入口：[videosreeeen.pages.dev](https://videosreeeen.pages.dev)。
- 运行时代码：`cf3c48d6fcf1b1b42750bbca36d6330ed889488a`。
- Worker：`c91a1fb3-387c-4cd2-8168-748ce5b85115`。
- Pages：`3367084c-72b1-4260-a7e1-899363002cbd`，部署元数据对应上述提交。
- 主脚本：`assets/index-JoS2ah6s.js`，SHA-256 `14fa2a5c0fd81b6095991274e613e90f0740ee8cf220f0e2ec625a9ab1cc9773`。
- 本机视频 Worker：`public-video-sw.js`，SHA-256 `d02b3f05f2cf6c1402c0a75195e7689bb01b7d77a4134dd31730ae8ad602bfc7`。
- 正式域名 HTML、主脚本、CSS 和本机视频 Worker 均与构建逐字节一致，健康版本仍为 0.4.3。

使用 `VS_PUBLIC_URL=https://videosreeeen.pages.dev` 对同一链接重新执行完整双端脚本，不替换 `/config`、原站成功响应或视频，实际使用正式房间服务和原 CDN：

| 项目            | 正式入口结果                                                          |
| --------------- | --------------------------------------------------------------------- |
| 识别与首帧      | 2374 ms，两端正确接管视频请求                                         |
| 画面与音频      | 两端 1920×1080，445 / 442 帧，音频解码 474247 / 469209 字节           |
| 连续观看 10 秒  | 新增 255 / 253 帧，时间前进 10.62 / 10.56 秒                          |
| 播放控制与恢复  | 播放中拖动继续出帧；暂停、5 秒与 1.25 倍速一致；观众离线 3.5 秒后恢复 |
| 下一集          | 同线路 `203803?source=xfxf1` 自动接播，两端解码                       |
| 取消与失败      | 识别取消、接口失败、首帧失败及下一集取消均保留当前媒体                |
| 页面 / 房间错误 | 无                                                                    |

忽略目录中的证据为 `.local/xifan-xfxf1-playback-public-evidence.json` 和 `.local/public-xfxf1-web-source-evidence.json`。本节之后的记录提交仅更新文档，不重新构建或发布安装包。

## 验证边界

这是同一电脑上两份独立浏览器资料的验证，不等于异地网络、Android / iOS 真机或整集连续观看通过。源站下载速度仍可能影响各端缓冲，缓冲保持本机隔离。xfxf1 整集落盘 / P2P 未实测；Service Worker 不为缓存下载开放原站没有提供的跨域权限。Windows / Android 没有重新打包或发布 Release。
