# 0.3.0 验证记录

日期：2026-10-18。Android + Windows；苹果只使用浏览器。此前的 [0.1.0](verification-0.1.md)、[0.2.0 验收历史](verification-0.2.md) 单独保留。

运行时代码：[0847de0](https://github.com/BorderArea01/VideoSreeeen/commit/0847de0913697aa8a62052094faf70319df49d97)。本地产物与部署标识保存在 `artifacts/build-info.json`；不将安装包、下载的视频、临时邀请或认证信息提交到源码历史。

## 已部署

- 公共入口：**https://videosreeeen.pages.dev**。
- Pages 部署：`337cb8d2-4967-4bc0-a0ca-e0e37eec36ed`，构建元数据提交与上述运行时代码一致。
- 房间 Worker：`videosreeeen`，版本 `2275afff-af3c-4c85-ae21-f50bb9169c74`。Pages 使用内部 Service Binding 连接它；每个房间一个 SQLite Durable Object。
- 未升级付费订阅，未配置 TURN 或视频中转。原有其他 Worker / Pages 项目没有修改。
- `workers.dev` 在本机网络访问超时，因此增加 Pages 入口；Pages 已完成下述公网验证，不将域名可解析单独当作可用证据。
- 从公共入口回读活动 JavaScript 与 CSS，逐字节核对与本轮构建一致：`index-BRqFeJZn.js` / `index-c8L2uK2H.css`。

## 新手与邀请流程

- 实际 Edge 创建房间：只需昵称，建房界面不展示服务器或邀请码输入；创建成功自动展示服务端生成的邀请。
- 打开完整邀请直接进入加入页。已保存其他服务器时，刷新邀请页仍使用邀请本身的服务器；不会覆盖用户默认配置。
- 无效邀请在原表单报错并恢复按钮，修正后可直接重试。模拟剪贴板拒绝后，邀请仍可见、可选中手动复制。
- 高级设置修改后，当前邀请与断线重连仍使用当前房间的实际服务器；验证恢复原成员身份，未在另一个服务器误建房间。
- 两个真实成员入房、互发聊天，离开后界面恢复待加入状态。390 px 手机布局截图与实际加入按钮点击通过；邀请、设置面板和桌面界面均已截图检查。
- 设置内新增新手指引、端能力差异、开源仓库和反馈入口；README、贡献指南与问题表单区分使用者和开发者。客户端公开下载、稳定发行签名与自动更新尚未完成。
- 系统分享按浏览器能力显示，并保留复制方式；本轮没有操作系统分享面板或实际发送给他人。

## 自动测试与实际闭环

- 20 项单元/集成测试通过；类型检查、共享前端、Node 后端、Workers 类型检查和部署试打包通过。
- GitHub 云端 CI 本轮未运行。0.2 手动派发返回 `HTTP 422: Actions has been disabled for this user`；本轮未反复派发，不能标为 CI 通过。
- 本地 workerd 经 Pages Service Binding 的真实 WebSocket：创建/加入、聊天、成员恢复、定向连接信令；主动休眠后原连接仍能恢复聊天和房间状态。没有连接的成员不能保持缓存 ready。
- 单个 Edge 浏览器上下文：浏览器之间完整 P2P 缓存；阻断接收端视频源请求后仍取得全部 **1,128,375 字节**，接收端源站下载为 0。
- 同时开始下载：两位成员各保存完整视频，测试视频源合计传出的有效分块正文为 **1,128,375 字节**，即一份视频；其余通过成员互传补齐。
- 故意修改发出的数据帧：接收端拒绝不符合声明哈希的块，回退独立源站并取得正确内容，最终仍通过全员指纹门槛。
- Windows → 浏览器，以及浏览器 → Windows 磁盘缓存均通过。包括浏览器无法访问源站时与 Windows 同时开始下载，以及 Windows 在另一成员已经缓存后中途加入。
- 缓存可实际播放、全员结束后自动清理；做种成员退出后，已经完整缓存的接收端仍可播放并清理。
- 实际公网 `https://videosreeeen.pages.dev`：建房、加入、双端聊天、WSS，以及 Windows 向浏览器传送完整视频、从本地缓存播放和结束清理。公网验证使用同一台电脑上的两个客户端，不等同于已验证跨运营商直连。
- 测试视频使用 MDN 的 CC0 flower.mp4，不在仓库或客户端中分发。

## 安装包

| 产物                                   | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| Windows `VideoSreeeen 0.3.0.exe`       | `92DAD5A9CBC615800F66CB0629BD9445E9A3A928CE28491CF38AD66B04826AF8` |
| Android `VideoSreeeen-0.3.0-debug.apk` | `0FE3C15B3C4FAA11C9D9F1BE2CE28B558F927A197F98BBB22C0CAFA1D5175DD5` |

Windows 成品已实际运行：首次默认地址为公共 Pages 服务；顶部“打开网页版”按钮传给系统浏览器的地址正确，验收时拦截了系统打开动作，没有额外打开用户浏览器。内置 Node 服务、建房、视频播放、完整分块落盘与本地缓存播放/清理通过；关闭后内置服务停止。便携 EXE 自解压、真实窗口截图和退出通过。测试前后的已有连接设置备份并恢复。

保留 0.2 对 Vite `envDir` 的修正，本轮再次验证成品默认地址。Windows EXE 为便携测试版，未提供发行证书签名或自动更新。

Android：编译和 Lint 通过，0 错误、4 条提示（WebView JavaScript、备份配置及两个保守磁盘空间检查）。APK 包名为 `io.github.borderarea01.videosreeeen`，versionCode 3 / versionName 0.3.0，minSdk 26 / targetSdk 35。解包核对其活动前端资源与当前构建完全相同，包含正确公共默认地址；为调试签名，尚无正式发行签名。**只生成 APK，没有安装或操作任何设备。**

## 范围与尚未验收

- P2P 当前支持 MP4 / DASH 完整文件；HLS 保留有限、非加密完整下载，尚不互传。DASH 多轨有实现，但没有把目标 B 站长视频的全程实播列为已验收。
- 浏览器单轨最多 96 MiB、合计最多 128 MiB；原生客户端最多 4 GiB，预留 256 MiB 磁盘。苹果 Safari、Android 真机、后台/锁屏、跨运营商网络和长视频尚未验收。
- 本轮 Windows 原站探测：Bilibili 检测到 196 秒 DASH；喜番检测到 1420.132426 秒 MP4；蜜柑检测到 1420.224 秒 MP4。喜番此前访问失败，本轮可以探测到播放器与源；这些结果不等于三站长视频全程同步或缓存通过。
- 默认没有 TURN；无法直连且无法下载源站时，会明确失败，不保证所有网络都能零中继观看。
- 免费额度按账号汇总，使用仍受平台请求、活跃时长和存储配额限制。
- 本轮未构建 Docker 镜像、未启动模拟器。

所有本地构建/测试串行经受控入口执行，检查实际 `NRC-Win64-Shipping` 与可用内存；仅清理所属进程，没有按窗口标题判定游戏，没有全局终止 Java。

本机详细证据：`.local/onboarding-evidence.json`、`.local/ui-evidence.json`、`.local/p2p-evidence.json`、`.local/worker-evidence.json`、`.local/public-evidence.json`、`.local/package-evidence.json`、`.local/apk-evidence.json`；截图位于 `.local/screenshots/`。这些本地文件不提交仓库。
