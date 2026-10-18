# 播放器加载冲突修订

2026-10-18。用户截图显示 `play()` 被新加载请求中断，并伴随黑屏。本轮修订针对播放器输入的所有权与异步播放请求，不能仅隐藏报错就称为故障已解决。

## 修改

- 房间接受本机采集时，保留同一播放器里的活动流，不执行暂停、清空或重新加载。传输连接重新配置也不清除本机预览；停止共享仍正常解绑和释放。
- 同一远端流的音轨和视频轨事件只绑定一次 `srcObject`，避免第二次事件打断首帧播放。
- 统一播放器的异步播放请求：相同输入有请求未完成时不重复发起；换片后忽略旧输入返回的结果。正常暂停或加载取消的 AbortError 不再误报成自动播放权限不足；NotAllowedError 仍提示本机授权，其他真实错误继续显示。
- 异步加载媒体在等待后核对媒体 ID、房间代次与模式，过期加载不会重新覆盖当前播放器。

## 本地验收

- `npm run verify` 通过：格式、25 项测试、TypeScript、前端 / Node 构建、Worker 类型检查和 dry-run。
- 真实 Edge 标签页采集通过：房主确认前为 1590×1062、35 帧，像素采样 2259 点非黑；确认后仍为原流，解绑 0 次、重复绑定 0 次、带流调用 load 0 次。
- 观众实际解码 23 帧并接收音频 RTP；输入解绑、重复绑定与带流 load 均为 0。停止释放、取消重试和无采集入口替代验证通过。
- `test:broadcast`：960×540 文件音视频、暂停、拖动、后来加入与停止清理通过。
- `VS_DENY_AUTOPLAY=1` 的文件共享回归通过：模拟浏览器拒绝自动出声后，用户点击可解除本机限制，不改变全房间播放为暂停。该检查不代表 Safari 真机验收。

本地证据保存在忽略目录 `.local/playback-lifecycle-local-evidence.json` 与 `.local/broadcast-autoplay-evidence.json`。样片验证是同机不同页面，不代表用户原站页面或不同网络已经验收。本轮仍遵守已获游戏期间执行授权及 1536 MiB 内存门槛，任务串行且经受控入口执行。

## 部署

- 正式入口 <https://videosreeeen.pages.dev>，运行时代码 `79be15295badbfad07cbcc064878e6bcc826163b`，已推送 GitHub。
- Pages 部署 `a270b964-7aeb-44b3-89aa-38da17c184c5`；Worker 版本 `bfc12b5e-e7e6-4703-9951-55e2c9875ad1`。
- 线上 HTML、JS 与 CSS 与本机构建逐字节一致；部署元数据提交匹配。JS `/assets/index-C9RXVQmc.js` 的 SHA-256 为 `239a9bec8efd65eeadb1598332c9a5207c272c2e55c4d55cc7cca12dc20a6a40`；CSS 沿用 `index-CvOf_f_s.css`。
- 公网 `test:browser-share` 完整通过：服务器确认前房主已解码 33 帧，采样 2254 点非黑；确认后原流保持，解绑、重复绑定和带流 load 均为 0。观众实际解码 11 帧并接收音频 RTP，同样无重复绑定或解绑；取消重试、停止清理、替代入口、手机布局与页面错误检查通过。
- 首次公网脚本在后续换片步骤超时：轨道停止不代表服务器已确认 unshare。脚本补充等待双方回到欢迎页，再提交新的版本化媒体操作，随后完整重测通过。运行时代码未因该测试时序调整再次变化。
- 初次部署核对因直连超时失败；改用本机 Clash 代理后完成全部线上资源核对，没有将超时结果记为成功。

公网证据：`.local/playback-lifecycle-public-evidence.json`、`.local/public-web-source-evidence.json`。公网播放器截图已目视确认正常样片画面。以上为同机不同页面连接真实 Cloudflare 服务的验证，未验收不同网络、用户截图中的原站视频或 Android 真机；本轮未重打安装包或安装设备。

## 依据

[Chrome 官方对 play 请求被中断的说明](https://developer.chrome.com/blog/play-request-was-interrupted)及 [HTML 媒体加载规范](https://html.spec.whatwg.org/multipage/media.html#dom-media-load)说明加载或暂停会影响未完成的异步播放请求。本轮同时修正导致重载的调用链，并用真实视频流连续性验收。
