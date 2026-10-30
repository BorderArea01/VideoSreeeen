# 下一集首帧与起播顺序（2026-10-31）

现场反馈：稀饭共同播放切到下一集，切换者正常，其他观众开始几秒黑屏。以下工作在新建房间、独立浏览器资料中进行，不控制用户正在观看的房间。

## 复现与修改

原流程只由切换者等待自己的 loadeddata / seeked 后发送播放。它在识别阶段已加载过新源，观众则需要从冷连接加载；房间时钟会在观众尚无画面时前进。三端测试故意阻塞一位观众的新集视频，旧版在该观众无首帧时已经发送播放，`.local/next-start-before-evidence.json` 记录了这个顺序。

- 新网页声明 `playback-ready-v1`，上报本机新媒体首帧；服务端按媒体 ID、缓存代次和在线成员核对，确认不增加播放版本，不更改 RTT、不触发暂停。旧客户端字段缺省，保持兼容。
- 支持时使用 requestVideoFrameCallback 确认实际提交的视频帧，分离音轨另等加载；不支持该 API 时退回 loadeddata、尺寸和非 seeking 检查。真实 AL 的 HEVC 在暂停态可能不提交首帧，因此仅本机静音解码到首帧后立即暂停，继续保持房间 0 秒等待。音量避让、用户手动音量不能取消预热静音。
- 自动续播先短等在线成员的首帧，最多约 8 秒。超时后已准备好的成员开始，慢端保留加载状态并自行跟随；不把正常播放中的某个人缓冲变成全房暂停。用户手动播放仍可直接开始，手动暂停、换片、换模式会使旧续播失效。
- 起始位置已经接近 0 时不再重复写 currentTime=0，避免打断解码；首次中途加入和真实手动跳转仍可以定位新位置。换源取消帧回调与等待，过期结果不能恢复旧片。

## 验收

- `VS_NEXT_EXPECT_OLD=1 npm run test:next-start` 在旧构建上复现“观众无首帧时房间已播放”；新构建同一测试验证三个浏览器收到播放时均已提交首帧，冷端加载时房间保持 0 秒，手动暂停不被迟到结果覆盖。
- 使用真实 `https://next.xifanacg.com/anime/3434/play/203799?source=AL` 与原 CDN，在两份浏览器资料中解码 1920×1080 和音频、暂停、播放中跳转、倍速及实际切到同线路 203800 通过；未用视频代理或共享画面。原始脱敏记录 `.local/xifan-AL-playback-evidence.json`。这不是所有稀饭线路或手机硬件验收。
- 延长阻塞观众的新片响应，新版在约 8.2 秒放行健康成员，慢端保持静音加载、恢复后本机跟上，期间播放版本不被缓冲改成暂停。证据 `.local/next-start-local-evidence.json`。
- `npm run verify` 通过 116 项测试、格式、TypeScript、前端 / Node 构建和 Worker dry-run；`test:worker` 经实际 Durable Object 休眠恢复，验证首帧确认不改播放版本，并保留此前聊天、图片、语音、票选和缓存窗口回归。
- `test:player-controls` 的实际 MP4 播放、预览、精细跳转、HLS 预览与全屏回归通过；`test:cache-window` 的双端首批解码、边播删盘、不可跳转区间、整片指纹与片尾清理通过。
- 受控入口为 `scripts/controlled.ps1`，串行、Node 堆 384 MiB，合成测试物理输出静音，不访问用户麦克风。

构建、补充边界回归及集中部署回执在本轮验证完成后补记。当前说明不等于已经部署。

参考：[HTML 视频帧回调](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)、[hls.js 起播与初始化时序](https://github.com/video-dev/hls.js/blob/master/src/controller/stream-controller.ts)。没有修改原站权限、CDN 签名或画质选择。
