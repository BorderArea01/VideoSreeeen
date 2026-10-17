# 0.2.0 验证记录

日期：2026-10-18。Android + Windows；苹果只使用浏览器。此前的 [0.1.0 验收历史](verification-0.1.md) 单独保留。

运行时代码：[1c29336](https://github.com/BorderArea01/VideoSreeeen/commit/1c293360b0d97b46b4b73640eb89f05b6fc2f67c)。本地产物与部署标识保存在 `artifacts/build-info.json`；不将安装包、下载的视频、临时邀请或认证信息提交到源码历史。

## 已部署

- 公共入口：**https://videosreeeen.pages.dev**。
- Pages 部署：`50989517-f8c0-458d-84ad-b6ecd6ca5184`，构建元数据提交与上述运行时代码一致。
- 房间 Worker：`videosreeeen`，版本 `6b3090cd-61b8-472a-91ee-f06b1d8dd23b`。Pages 使用内部 Service Binding 连接它；每个房间一个 SQLite Durable Object。
- 未升级付费订阅，未配置 TURN 或视频中转。原有其他 Worker / Pages 项目没有修改。
- `workers.dev` 在本机网络访问超时，因此增加 Pages 入口；Pages 已完成下述公网验证，不将域名可解析单独当作可用证据。

## 自动测试与实际闭环

- 18 项单元/集成测试通过；类型检查、共享前端、Node 后端、Workers 类型检查和部署试打包通过。
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
| Windows `VideoSreeeen 0.2.0.exe`       | `E44CD0BE39027580AFA0C1F0B69EEAF8BD480D3EE98A7A33F4950B7DC67FFDAA` |
| Android `VideoSreeeen-0.2.0-debug.apk` | `AB3916922D7F50542F6B5187EB20E1DAD24362296F37E0DCE77DE13691DB8248` |

Windows 成品已实际运行：首次默认地址为公共 Pages 服务；顶部“打开网页版”按钮传给系统浏览器的地址正确，验收时拦截了系统打开动作，没有额外打开用户浏览器。内置 Node 服务、建房、视频播放、完整分块落盘与本地缓存播放/清理通过；关闭后内置服务停止。便携 EXE 自解压、真实窗口截图和退出通过。测试前后的已有连接设置备份并恢复。

成品检查曾发现 Vite 以 `client` 为根目录，导致未读取根目录的 `.env.production`。已修正 `envDir`，重新构建并通过上述成品默认地址检查，不能以源码里存在网址代替成品验证。

Android：编译和 Lint 通过，0 错误、4 条提示（WebView JavaScript、备份配置及两个保守磁盘空间检查）。APK 包名为 `io.github.borderarea01.videosreeeen`，versionCode 2 / versionName 0.2.0，minSdk 26 / targetSdk 35。解包核对其活动前端资源与当前构建完全相同，包含正确公共默认地址。**只生成 APK，没有安装或操作任何设备。**

## 范围与尚未验收

- P2P 当前支持 MP4 / DASH 完整文件；HLS 保留有限、非加密完整下载，尚不互传。DASH 多轨有实现，但没有把目标 B 站长视频的全程实播列为已验收。
- 浏览器单轨最多 96 MiB、合计最多 128 MiB；原生客户端最多 4 GiB，预留 256 MiB 磁盘。苹果 Safari、Android 真机、后台/锁屏、跨运营商网络和长视频尚未验收。
- 目标站点的原站探测基线见 0.1.0 历史；本轮没有宣称喜番已恢复可用，也没有将视频 URL 识别当作三站全流程兼容通过。
- 默认没有 TURN；无法直连且无法下载源站时，会明确失败，不保证所有网络都能零中继观看。
- 免费额度按账号汇总，使用仍受平台请求、活跃时长和存储配额限制。
- 本轮未构建 Docker 镜像、未启动模拟器。

所有本地构建/测试串行经受控入口执行，检查实际 `NRC-Win64-Shipping` 与可用内存；仅清理所属进程，没有按窗口标题判定游戏，没有全局终止 Java。

本机详细证据：`.local/p2p-evidence.json`、`.local/worker-evidence.json`、`.local/public-evidence.json`、`.local/package-evidence.json`、`.local/apk-evidence.json`；截图位于 `.local/screenshots/`。这些本地文件不提交仓库。
