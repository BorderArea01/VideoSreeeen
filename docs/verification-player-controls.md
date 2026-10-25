# 网页播放器：全屏闲置、画面预览与精细跳转

2026-10-25，用户要求全屏隐藏鼠标、进度预览、上拖精细定位、可选时长的前后跳转。本次沿用现有播放器、房间控制裁决和原有 UI，没有新增播放器框架或服务器产品。

## 交互与边界

- 网页全屏和系统全屏下，播放中在画面上闲置约 2.5 秒隐藏鼠标、控制栏与画面按钮；移动、点击、触摸、键盘或焦点操作恢复。暂停、拖动、控件悬停、键盘聚焦、弹窗或网页全屏展开聊天时保持可用。系统全屏改为包含画面与控制栏的同一个播放器容器，播放器和弹幕元素不重建。
- 悬停进度条显示时间和独立、静音、暂停的预览 video；不提取跨域像素，不调用主播放器 seek，不绕过原站权限。普通视频按需加载，HLS 使用独立小缓冲。移动停止 120 ms 后才请求新位置，移开 1.5 秒后释放；断线、换片、退出及缓存清理立即取消旧预览。预览失败显示时间及明确提示，不显示旧帧。
- 按住进度条向上拖动，横向步长依次降为 1/4、1/10、1/30；纯纵向切换精度不跳位置。刻度与时间只在操作时展示；松手提交一次既有房间 seek，拖动中主影片继续原状态。Esc、指针取消、失焦或换片不提交。鼠标、触摸使用同一 Pointer Capture 流程。
- 后退 / 前进支持 10、30、60、90 秒，默认 90 秒，预设保存在本机；按按钮才提交房间操作，目标限制在 0 到影片时长。共享画面隐藏时间线、预览和跳转；接收实时文件流无法随机读取源文件时只显示时间预览，提供者仍可用自己的文件预览。
- 不预下载全片、不生成或上传缩略图缓存、不把预览称为共同缓存。部分原站限制额外请求或随机定位时可能无法提供画面预览；原站内嵌客户端没有可供网页访问的源时仅保留时间预览。没有对原站、播放器或房间增加 Cookie 权限。

参考 [Video.js SeekBar](https://github.com/videojs/video.js/blob/8.x/src/js/control-bar/progress-control/seek-bar.js) 的待提交位置和播放位置分离、[Video.js 播放器](https://github.com/videojs/video.js/blob/8.x/src/js/player.js) 的用户活动处理、[W3C Pointer Events](https://www.w3.org/TR/pointerevents3/) 的指针捕获、[MDN seeking 事件](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/seeking_event)。独立实现，没有复制其代码。

## 验证入口

```powershell
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','verify') -AllowGameThisRun -MinFreeMiB 0
$env:VS_TEST_PROXY='http://127.0.0.1:7897' # 本机按需配置，可省略
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','test:player-controls') -AllowGameThisRun -MinFreeMiB 0
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','test:broadcast-relay') -AllowGameThisRun -MinFreeMiB 0
& ./scripts/controlled.ps1 -File npm.cmd -Arguments @('run','test:chat-overlay') -AllowGameThisRun -MinFreeMiB 0
```

测试使用本机隔离 Edge、实际视频解码、真实房间消息和两个合成成员；物理音频通过 `--mute-audio` 关闭。测试素材为公开 Sintel trailer 与 Mux HLS 测试流的两段低分辨率 TS，按需下载到忽略目录 `.local`，不提交视频或原始响应。触屏测试为浏览器触摸仿真，不代表 Android / iOS 真机验收。没有打包或发布新的客户端安装包。

## 本地结果

- 86 项单元测试通过，包含上拖改变精度时的位置连续性、步长比例和片头 / 片尾边界；网页与 Node 构建及 TypeScript、Worker 类型和部署 dry-run 通过。
- `test:player-controls` 的无 CORS MP4 预览实际解码 854×480、104 帧，预览位置 20.69779 秒，预览保持暂停和静音；主影片两端仍停留在 12 秒，悬停没有房间操作。
- 精细拖动从 26.1 秒到 27.2 秒，拖动中没有 seek，松手只有一条操作，两端实际 video 都跟随；Esc 取消没有操作。30 秒前进 / 后退及 90 秒片头 / 片尾截断通过，选择预设不发控制消息。
- 网页全屏和系统全屏均验证 `cursor: none`、控制栏不可误点、移动恢复与暂停不隐藏；390×844 视口按钮边界通过。系统全屏必须在前台标签页验收，后台页的浏览器拒绝不当作产品故障。
- CDP 触摸仿真实际向上拖动后只在松手发送一条 seek，两端跳到约 21.4599 秒；读取目标前等待最后一次触摸事件处理，不把异步事件调度当作同步完成。
- 公开 HLS 片段经本机测试服务播放，独立预览实际解码 320 像素宽、位置 14.1828 秒；移开后释放预览资源。
- `test:chat-overlay` 通过固定聊天高度、历史滚动、1.48 MB 剪贴板图片真实解码、全屏弹幕移动 / Emoji / 不重播历史、成员 RTT 一致及过期样本隐藏。旧脚本对“未选片时缓存入口隐藏”的断言更新为当前产品的“共同播放下折叠且不可启用”，没有改动缓存实现。
- `test:broadcast-relay` 通过实际 1280×720 画面和音频解码、预览静音、本机声音开关、新全屏容器、连续解码、重连、质量切换、迟到加入和停止清理；实时共享控制产生的房间操作为 0。

证据为忽略目录 `.local/player-controls-local-evidence.json`；截图 `.local/player-preview.png`、`.local/player-fine-seek.png`、`.local/player-controls-mobile.png` 已目视。未以手机视口或触摸仿真冒充真机结论，也未把这两个公共测试视频的结果扩大为所有原站的可用性承诺。
