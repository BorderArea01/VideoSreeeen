# 2026-10-31 共同缓存设置界面

## 范围

将共同缓存入口、开播条件、保存位置和说明统一为紧凑面板，沿用原有深色与暖橙色。桌面两列、手机单列；长目录省略显示，鼠标悬停可查看完整名称。支持目录选择时显示“选择目录 / 更换目录”，无此能力时显示由浏览器或系统管理，不显示无效按钮。详细限制支持点击展开，适用于触屏和键盘。

保留默认关闭、完整 / 首批 1/2 / 首批 1/3、全员落盘与指纹门槛、逐批清理、服务器状态裁决。只修改前端布局与说明，不改协议、缓存实现、服务配置或既有房间。

## 隔离验证

- 前端 TypeScript / Vite、Node 构建及助手 ZIP 构建通过；助手仍为 0.1.1，ZIP SHA-256 保持 `4c94b6e9c51934513326402fd1d34a21d42da72f3a3052349113f85b38a13307`。
- 独立无头 Edge 和新建房间验收：展开设置、切换条件和切换播放方式不发布房间控制；明确操作开关才改变房间模式。启用时显示“已启用”且锁定条件，关闭后恢复可选。
- 目录选择使用独立测试存储句柄，不访问用户视频或其他目录。更换目录后显示真实句柄名称；无目录选择能力时正确显示系统存储说明。
- 1440px 桌面、390px / 320px 窄屏截图已目视检查，页面无横向溢出；这些是桌面浏览器视口，**不代表手机真机验收**。
- `npm run test:cache-window` 通过：真实双端 MP4 首批解码、继续下载、逐批删盘、灰色不可跳转范围、整片指纹、片尾清理、完整缓存回归与目录记忆。
- `npm test` 的 116 项测试通过；`git diff --check` 通过。
- 验收证据为本机忽略目录中的 `.local/cache-ui-evidence.json`、`.local/cache-window-evidence.json` 与 `.local/screenshots/cache-ui-*.png`。README 使用独立面板截图，不含影片画面或用户房间信息。

构建与浏览器任务经 `scripts/controlled.ps1 -AllowGameThisRun -MinFreeMiB 0` 串行执行。没有操作用户正在观看的房间、麦克风、共享或设备；不重新打包客户端，不触发客户端发布工作流。

## 部署

- 运行时代码 `29da1dece509755f3f5998e2e682e1f25b4170e9`；Pages 部署 `b1a527f1`，正式入口仍为 <https://videosreeeen.pages.dev>。
- 本轮仅更新 Pages 静态网页；房间 Worker 保持 `4091586b-6275-4ba8-9be5-bd2c680a3e92`，没有重新部署或迁移 Durable Objects。
- 新入口 `assets/index-Dw3gj2-w.js`，SHA-256 `4bb47a0c9c68c33850c9791ac892e8246e8c0c999078ebff664589f03a38cc3e`；CSS `assets/index-D5GE4kub.css`，SHA-256 `6cf53a65d849be2ec9c29a72b7b67c433a26a1919defa5b5d84dfbbe248283ed`。已核对线上 HTML 引用，以及入口、CSS、缓存线程、语音线程、Service Worker 和助手 ZIP 共六项产物与本地一致；回执 `.local/cache-ui-public-assets.json`。
- 公网隔离房间的界面、目录显示、条件选择、模式开关、启用锁定、关闭恢复和 390px / 320px 布局检查通过。视频使用受控 MP4 fixture，房间状态走真实公网 WSS，不代表原站全线路或手机真机验证。证据 `.local/cache-ui-public-evidence.json`。
- [GitHub Verify](https://github.com/BorderArea01/VideoSreeeen/actions/runs/41101845315) 已触发；记录时仍在等待 GitHub runner，本地 116 项、构建和缓存回归已通过。没有触发客户端发布工作流或修改 Release。

唯一回退版本仍按 `.local/rollback/manifest.json` 定位，没有为本轮建立额外历史构建目录。当前前端构建及 Pages 上传目录各不足 1 MiB，未新增安装包或大体积编译中间产物。
