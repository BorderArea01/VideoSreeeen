# 免费备用视频通道（待完成验收与部署）

2026-10-18（北京时间）。用户远程双方诊断已确认采集正常、协商 stable，但 ICE 未选中可用路径、RTP 发送为零；用户无 VPS，继续要求零付费。现有线上版本仍是 `index-Bz-IGdsh.js`，本报告中的备用通道尚未部署，不能视为跨网黑屏已修复。

## 方案与范围

保留 WebRTC 直连。新版浏览器观众直连约 15 秒未成功时，尝试同一服务上的独立 `/broadcast-relay` WebSocket；发布端只有在备用通道存在接收者时才启用 MediaRecorder。接收端使用 MediaSource / ManagedMediaSource 播放连续的音视频容器，不通过房间聊天 WebSocket 传输媒体，不上传或缓存整部电影。

该方案是应用层音视频转发，不是 TURN，也未创建 Realtime / R2 等新产品、修改订阅或申请付费额度。复用既有 `WatchRoom`，不增加 Durable Object namespace 或另一个房间状态所有者。Cloudflare 文档说明 Workers Free 超限后相应操作失败；不能把它表述为免费无限带宽。现有 OAuth 的订阅读取返回 403，本轮未通过该 API 重新独立核验账户订阅；不把“部署没升级套餐”当作读取账单成功。

原站视频直链代理 `/media` 仍关闭，共同缓存与 WebRTC DataChannel 协议不变。视频经过备用通道时需重新编码，会增加延迟并降低画质；支持格式依双方浏览器实际报告协商，不声称所有苹果浏览器已验证。

## 约束与恢复

- 握手校验成员恢复令牌、在线身份、当前媒体及 epoch；只允许媒体提供者发布，最多 4 位备用观众，身份令牌不放 URL。
- 媒体包净载荷最多 64 KiB、接收者未确认窗口最多 2 MiB、客户端排队/编码积压最多 2 MiB；服务端码率桶约 2 Mbit/s，另限制控制消息速率。
- 发布端编码目标视频 1.2 Mbit/s、音频 96 kbit/s。浏览器可能偏离编码目标，超出服务端约束会关闭通道。
- 接收端只保留约 30–45 秒实时缓冲，暂停时同样清理，避免把影片积累在内存中。这个缓冲不是共同缓存。
- 后加入、格式协商、休眠恢复时重新开始容器流；二进制包绑定编码代次及序号，旧异步编码结果不能串流，断包不继续假装播放。
- 慢观众单独关闭；换片、停止、离开或房间失联清理通道、解码源和编码器，不停止提供者仍在使用的采集轨道。
- 诊断增加备用通道状态、累计字节、格式和排队量，不导出凭证或媒体内容。

## 已执行与未执行

- 首版 `npm run verify` 通过：34 项测试、格式、前后端类型/构建、Worker 类型与 dry-run。此后又调整了浏览器打包依赖、播放权限提示、缓冲清理及 Worker 验收脚本，尚不能用首版构建代替最终产物。
- 调整后 9 项针对性测试通过，包含原直连恢复与诊断脱敏，以及备用通道鉴权、实际二进制转发、慢观众隔离、停止失效、编码代次和休眠恢复。
- `test:broadcast-relay` 会在隔离 Edge 中禁止 WebRTC 候选，生成测试画面与无外放的音轨，经真实独立 WebSocket 和 MediaSource 接收，检查视频帧增长、实际音频解码、重新加入、停止清理与诊断。首次执行时内存降至 1271 MiB，守卫终止；尚无通过结果。已缩减脚本为单渲染进程、96 MiB JS 堆、关闭 GPU，并准备使用直接 Node 入口减少启动进程；未宣称缩减后的验收已通过。
- 进一步尝试将 TypeScript 堆降为 192 MiB，因编译器自身堆不足退出；这不是类型检查通过，后续应恢复既有 384 MiB 上限，在资源充足时执行。
- `test:worker` 已增加 Pages → Worker → Durable Object 真实二进制转发、休眠后授权恢复、成员连接不被媒体连接替换及停止关闭检查；本轮新版脚本尚未执行。
- 游戏重新启动后用户明确授权本轮串行构建、测试和部署，仍保留 1536 MiB 内存门槛。被守卫停止后未后台自动重启，也未操作用户的游戏或其他应用。

## 完成前剩余步骤

1. 资源足够时完成最终格式、类型与构建，以及本地真实备用通道和 Worker 回归；修正任何实际失败。
2. 回归原有真实标签页 WebRTC 直连，确认新增备用通道没有破坏预览与播放生命周期。
3. 再更新现有 Worker、Pages 并核对线上提交、活动资源哈希。以禁止直连的公网浏览器验证独立转发真实画面/音频；这仍不等于用户远程网络已恢复，最后需双方刷新线上版本验证。

## 官方依据

- [Workers WebSocket API](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [Durable Objects 免费额度及超限行为](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Developer Platform 专项条款](https://www.cloudflare.com/service-specific-terms-developer-platform/)
- [WebKit 对 MediaRecorder 格式与 MediaSource 的说明](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)
