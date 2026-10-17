# 0.3.1 验证记录

日期：2026-10-18。修复用户报告的 B 站链接停留在“已共享原站页面”。历史记录：[0.3.0](verification-0.3.md)、[0.2.0](verification-0.2.md)、[0.1.0](verification-0.1.md)。

运行时代码：[966d52b](https://github.com/BorderArea01/VideoSreeeen/commit/966d52b4a9d9ecee67882f1b0e631634c95d2f89)。本地产物和完整证据索引见 artifacts/build-info.json；不提交安装包、媒体内容、临时邀请或认证信息。

## 实现

- 网页只有原站 URL 时显示“等待客户端识别视频”，禁用无效播放和缓存切换，提供邀请客户端与使用方法。直链加载失败时持续展示缓存兜底，HLS 不冒充支持浏览器完整缓存。
- Windows / Android 在当前页面检测到可访问视频后自动共享一次源，保留手动重试。异步结果绑定媒体 ID，冲突沿用服务端版本裁决。
- 同一页面第一次补充源保留播放时间线；媒体 ID 和缓存代次仍更新，换片仍重置。Windows 保留原站视图，不强制切换到可能遭源站拒绝的直接播放器。
- B 站选择原站实际提供的普通 HTTPS 端口备源及 AVC/AAC 音轨，不拼接签名地址。切换缓存时等待原站关闭和旧缓存清理，避免过早点击。

## 实际视频闭环

视频：[BV13Aa66LEAW](https://www.bilibili.com/video/BV13Aa66LEAW/)，原站标记 164 秒，本地视频轨时长 163.000688 秒。去除用户分享链接中的跟踪参数。

- 本地 Node 服务与公网 Pages 均验证：真实 Windows 原站打开后自动共享 DASH；没有点击识别按钮。原站视图仍存在且能采样。
- 公网直接媒体加载失败，显示可操作的共同缓存入口；并未把链接识别或 iframe 加载算作可播放。
- Windows 完整下载约 5.6 MiB；网页从成员取得完整音视频，源站下载 0.0 MiB，测试阻断了网页的视频源和中转下载路径。服务端全员内容指纹门槛放行后才开始播放。
- 最终公网验收使用实际打包的 Windows EXE 与一个 Edge 上下文。暂停后 Windows 0.901837 秒、网页 1.079762 秒，双方 paused 均为 true；网页音轨 0.958901 秒。
- 双端能播放、暂停及拖动到末尾，触发真实 ended 事件后自动清理。验证采用开头实播与拖动到尾部，没有把它写成完整观看了 2 分 44 秒。
- 首次成品原站识别等待超时，后续重试通过；不能保证源站每次加载成功。测试补充成员状态、暂停和拖动的确认等待，避免公网 RTT 下连续发旧版本操作。
- 没有注入账户 Cookie、绕过登录/付费/DRM、开启视频中转或付费 TURN。

## 回归与成品

- 22 项测试、类型检查、前后端构建、Workers 类型检查及部署试打包通过。新手流程验证了无源提示、失败后的缓存入口和手机实际点击，截图已目视检查。
- P2P 双向、同时下载、坏块拒绝与源站回退、成员退出、缓存播放与清理通过；Workers 实际 WebSocket、休眠恢复及聊天保留通过。
- Windows 成品实际运行：默认公共地址、网页版按钮、本机服务、完整缓存播放/清理、便携启动和退出通过。ASAR 内活动前端和原站桥接脚本逐字节核对通过，测试前后的原有设置备份恢复。
- Android 编译和 Lint 通过，0 错误、4 条提示；versionCode 4 / versionName 0.3.1，minSdk 26 / targetSdk 35。APK 活动前端和原站桥接与当前构建一致，默认连接公共服务。只生成 APK，未安装或操作任何设备。

| 产物                         | 字节     | SHA-256                                                          |
| ---------------------------- | -------- | ---------------------------------------------------------------- |
| VideoSreeeen 0.3.1.exe       | 99643886 | 1925CF070D074068DA1B3D8EDBF63FCD6995D564F71188702EF1780128E30073 |
| VideoSreeeen-0.3.1-debug.apk | 1887217  | 9CCDF5526758F4156E4BCE6441DCEA9731EE7A2B00097BDC6C0A3E98FF8DA4B5 |

## 部署

- 公共入口：https://videosreeeen.pages.dev。
- Pages：72cd21e0-c142-4654-aab6-ba372c91c6b7，元数据提交与上述运行时代码一致。
- Worker videosreeeen：d01422bf-823a-470a-875c-67d9fb17438b；每房间一个 SQLite Durable Object，Pages 通过 Service Binding 使用同一房间服务。
- 回读并比较线上活动前端与本地构建：./assets/index-BL5Le0S4.js 和 ./assets/index-COtY5BUb.css 完全一致。
- 沿用已授权账号和原有项目，未升级付费、启用中继或改动其他项目。

## 仍然存在的边界

- 只有浏览器成员的房间，尚不能直接解析、控制 B 站等原站页面。至少需要一位 Windows / Android 成员；原站访问限制仍适用。普通外链播放器不能当作本项目的同步控制接口，参见 [B 站外链文档](https://player.bilibili.com/) 与 [同源策略](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy)。
- 苹果 Safari、Android 真机、后台/锁屏、跨运营商直连和长视频未验收；本轮使用同一电脑上的 Windows 与 Edge。
- 浏览器缓存单轨 96 MiB、总计 128 MiB；原生最多 4 GiB。HLS 保留有限原生缓存，不支持浏览器完整缓存或 HLS P2P。
- 本轮没有重跑喜番、蜜柑全流程；0.3 的探测记录不是全程实播证明。未启动模拟器或构建 Docker。
- 客户端为开发测试包，尚未公开发行、配置稳定发行签名或自动更新。GitHub Actions 本轮未运行；此前账号级禁用记录见 0.2，未反复派发或将本地通过当作云端 CI 通过。

所有高内存任务均由受控入口串行执行，检查真实 NRC-Win64-Shipping 和内存；未根据窗口标题判断、全局杀 Java 或操作其他设备。

本机证据：.local/onboarding-evidence.json、worker-evidence.json、p2p-evidence.json、bilibili-local-evidence.json、bilibili-evidence.json、package-evidence.json、apk-evidence.json、asar-evidence.json；截图位于 .local/screenshots。这些文件不提交仓库。
