# 跨网络共享连接状态与恢复

2026-10-18。用户确认共享者本机已正常显示画面，观众使用不同网络且连接超过一分钟仍黑屏。因此本轮排查对象是观众传输连接，不能继续称为“提供者没有开始共享”。

## 已确认与边界

- 实际线上 `/config` 只有一个 STUN 配置，`hasTurn=false`、`mediaRelay=false`。跨网直连无法建立时没有中继兜底，但尚未取得用户双方的 ICE 诊断，不能把具体 NAT 或防火墙类型当作已证实根因。
- 之前的公网验收是同机不同页面连接真实 Cloudflare 服务，不代表不同网络连通性通过。本轮仍不得用同机样片通过替代用户现场故障。
- Cloudflare Realtime 当前每月 SFU 与 TURN 共享 1000 GB 免费额度，超额每 GB 0.05 美元；它不是无费用风险的无限免费中继。未创建 TURN、未开通新计费服务或更改中继配置。

## 修订

- 共享发布、连接中、连接失败、已连接等待画面、实际接收与提供者离线分别显示；播放器、来源栏及准备窗口统一使用实际连接状态。
- 发布后不再让准备窗口残留“尚未开始共享”。连接失败时明确提示当前是否未配置中继，详细解释放在提示的鼠标悬停文本中。
- 原来 disconnected 事件只显示“正在重连”，没有执行重协商；现在提供方按既有退避周期发出 ICE restart，保留连接与媒体流。失败时不再立即关闭双方仍需用于恢复的协商对象，停止共享仍关闭资源。
- 异步协商与候选事件核对连接实例及媒体代次，旧协商不能带新媒体标识发送。

## 验证进度

- `npm run verify` 通过：28 项测试、格式与类型、前后端构建及 Worker dry-run。
- 新增连接对象测试验证断线后真正发出 ICE restart、退避、复用连接、失败后接受新 offer、离线/中继状态及旧代次取消。对象模拟用于状态机验证，不是跨 NAT 实测。
- 本地真实标签页采集通过：1590×1062 房主预览 33 帧，2257 个采样点非黑；观众实际解码 21 帧并接收音频 RTP。双方均无重复绑定或解绑，停止清理与替代入口通过。
- 公网脚本另准备失败状态的 UI 注入检查：仅覆盖“实际已有画面时连接失败状态不能误显示未开始或仍在接收”，不得当作真实网络失败与恢复证据。

待本轮文件回归、部署及公网脚本结果补充。证据保存在 `.local/broadcast-recovery-local-evidence.json` 等忽略文件中。运行时变更沿用用户本轮游戏期间执行授权，保留 1536 MiB 内存门槛及串行受控入口。

## 资料

- [MDN ICE restart](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce) 与 [WebRTC 官方重连样例](https://webrtc.github.io/samples/src/content/peerconnection/restart-ice/)。
- [Cloudflare TURN 服务](https://developers.cloudflare.com/realtime/turn/)与[当前价格及共享免费额度](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)。
