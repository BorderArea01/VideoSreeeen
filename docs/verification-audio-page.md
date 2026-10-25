# 网页视频音量、人声优先与网页全屏

2026-10-25。用户确认本轮反馈发生在网页版，并追加网页全屏需求。旧播放器仅有共享画面静音，没有通用视频音量；语音与影片独立播放，没有声音避让。

## 实现

- 播放器增加本机视频音量与静音，记住音量；与语音音量、房间进度分开。覆盖浏览器共同播放、共享画面观众、本地文件及缓存播放器。共享画面提供者的静音预览保持；其他标签页原站的声音仍由原站控制。
- 默认启用“人声优先”，可单独关闭。实际本机麦克风样本或经过接收抖动缓冲、未被本机静音的混音触发活动判定；不是读取成员开麦标志。每 20 ms 检测音频电平，40 ms 达到门限后启用，350 ms 停顿保持，100 ms 降到手动视频音量的 25%，600 ms 平滑恢复。低电平噪声、短字词间隙、成员静音、接收静音、断线、退出和手动调整均有独立处理。后台标签页不依赖被暂停的动画帧释放避让。
- 接收语音增加 100 Hz 高通、2 kHz / +2 dB 宽峰均衡和动态压缩（阈值 -18 dB、比例 3:1、attack 10 ms、release 200 ms）。它用于减少低频和突出清晰度，不是机器学习降噪或语音识别；既有麦克风降噪 / 回声消除及独立网络通道保持。
- 影片直接使用媒体元素的 volume / muted，**不把无跨域读取权限的视频接入 Web Audio**。本地文件 captureStream 的监听音量不改变捕获轨道；Canvas / Web Audio 分支使用独立监听 GainNode，发送分支保持原增益。
- 新增“网页全屏”，仅改变页面布局，保留浏览器标签栏及原有系统全屏。复用同一播放器，保留音量、弹幕、可展开聊天 / 语音；按钮与 Esc 可退出，恢复此前侧栏可见状态和滚动位置。切换不发送媒体或控制操作。

设计依据：[OBS 侧链避让](https://obsproject.com/kb/compressor-filter/)、[HTMLMediaElement.volume](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/volume)、[W3C 媒体元素捕获与监听音量隔离](https://www.w3.org/TR/mediacapture-fromelement/)。没有引入新的收费服务、原站代理或登录权限。

## 本地验证

受控串行运行 `npm run verify`：85 项单元测试、格式、TypeScript、网页 / Node 构建、Worker 类型及部署 dry-run 通过。新增用例验证活动门限、停顿保持、交叠渐变取消、静音保持、后台恢复，以及避让期间改变音量后恢复最新值。

`test:voice` 使用三个独立 Edge 资料、真实 WebSocket / Opus / 兼容解码及合成音源。物理输出始终通过 `--mute-audio` 关闭；不打开真实麦克风、不录制用户声音：

- 手动设置 60% / 80%，分别触发本机说话和收到语音，实际视频元素降至 15% / 20%；期间将前者改为 40%，实际变为 10%，停顿 / 退出恢复 40%。滑块始终显示用户手动值。
- 未开麦且没有声音的收听不降音量；关闭人声优先、静音接收、单独静音成员和输入静音样本后释放避让，互不修改另一端的手动值。
- 检查真实处理链输出的两路合成频率仍存在、输出非静音且峰值低于 0.95；没有以 UI 数字代替音频输出验证。
- 原设备选择、权限拒绝、180 ms 注入抖动、多人同时发声、兼容编码、重连只收听和停止轨道均通过。操作期间房间播放控制消息为 0，影片持续解码。
- 网页全屏实际铺满 1360×1000、820×950、390×950 视口，`document.fullscreenElement` 保持空；聊天实际发送到另一端，语音保持连接，退出恢复侧栏，同一个 video 元素继续使用。窄屏全部按钮边界检查防止底部裁切。

`test:playback-modes` 回归真实共同播放的暂停、拖动、倍速、选项切换与手机视口；`test:broadcast-relay` 回归共享画面、声音解锁、静音预览、系统全屏、重连、连续解码和停止清理。实时画面仍不显示虚假暂停 / 进度 / 倍速。

`test:broadcast` 分别强制媒体元素捕获和 Canvas / Web Audio 两条本地文件提供路径。提供者调到 30% 并静音后，发送轨道的实际 RMS 分别为 0.0652 / 0.3626，均非静音；观众继续解码画面和声音，迟到加入与停止清理通过。两条路径的输出样本不同，不以 RMS 大小比较音质。

复验入口：

```powershell
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','verify') -AllowGameThisRun -MinFreeMiB 0
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','test:voice') -AllowGameThisRun -MinFreeMiB 0
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','test:broadcast') -AllowGameThisRun -MinFreeMiB 0
$env:VS_FORCE_CANVAS='1'
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','test:broadcast') -AllowGameThisRun -MinFreeMiB 0
```

本机证据保存在忽略目录 `.local/audio-page-local-evidence.json`，截图为隔离浏览器和合成测试成员，不代表真实用户在线。手机视口只验证布局；没有完成 Android / iOS 真机、实体耳机、麦克风或真人听感验收。部分移动浏览器限制脚本设置媒体音量，不能据电脑测试承诺全平台避让。原站客户端与旧安装包不在本次网页版交付范围。

## 部署核对

2026-10-25 更新已授权的同一免费账号和原有资源，没有启用 TURN 或付费产品：

- 网页入口：<https://videosreeeen.pages.dev>；运行时提交 `afa5c4ceb1e61419302b9a2dcae32f66e20d9f88`。
- Worker：`11f1588c-e593-4cc5-9c2f-45a320ab93cf`；Pages：`9733bdb1-15aa-4b01-bea6-fda4be0a1ab9`。Pages 的 WATCH 继续绑定同一个房间 Worker。
- 公网 HTML、JavaScript、CSS、语音 worklet 与本地构建逐字节一致。JS `index-wjhGl4gP.js` SHA-256：`c30ac5368f01776cdf936726cce09862c785f11bfc8fa705145cb810859c7920`；CSS `index-bOvvBkJW.css`：`48b55faec68dd0fd3bdb3363e5fb36efcd39a3c5fa16019a203a3de68a7539c8`；worklet `voice-worklet--rrRYmB6.js`：`4286ee2049abeb4919f1721c28ed34683b81b4ca9729e095a878348906a199f8`。

第一次公网多人检查在切换兼容编码后，单次 FFT 的第二路频率为 -35.0399 dB，略低于 -35 dB 测试门限；原始数据保留于 `.local/audio-page-public-first-attempt.stderr.log`，该轮不记通过。检查改为最多 8 秒内等待同一采样窗口的两路频率同时在原始混音与处理后输出达到原门限，不放宽阈值、不修改运行时；它验证实际输出，不以收到的数据包替代音频测量。

调整采样方式后，针对上述公网入口的三成员检查通过：Opus、180 ms 注入抖动、三人同时发声、兼容编码、重连只收听和麦克风释放；两路原始混音频率为 -30.6700 / -30.5175 dB。新增音量、人声优先、关闭 / 静音 / 停顿 / 离开恢复、三个视口网页全屏、聊天实际送达、Esc 与原侧栏恢复均通过，房间控制消息为 0。证据为 `.local/audio-page-public-evidence.json`；仍使用合成音源和静音物理输出，不代表真人听感或跨设备真机结论。
