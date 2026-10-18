# 用户实际原站链接复验

2026-10-19。用户反馈此前从未成功，并再次提供蜜柑 `https://www.mgnacg.com/bangumi/193-3-17/` 与稀饭 `https://next.xifanacg.com/anime/151/play/1986?source=xfy2`。以前某次通过不能代表用户入口已可用，本次分别记录实际结果。

## 失败复现与修订

- 两个原站在隔离浏览器中按正常匿名流程均实际播放出 1920×1080。正式网页使用系统默认网络复验蜜柑，识别接口返回 422，内容为读取原站播放页 HTTP 403。不能把这个失败归结为用户没有打开原站。
- 稀饭之前没有网页识别实现：客户端提交逻辑只将蜜柑送去识别，其余原站直接拒绝。现增加稀饭 `xfy2` 旧番线路（原站 source ID 5）适配，通过原站正常使用的匿名播放接口 `issue-web-playback` 获取已签发视频地址。
- 实际预检与响应均允许 `https://videosreeeen.pages.dev` 跨域访问。浏览器直接发起请求，`credentials: omit`，不向原站发送本应用的房间令牌、成员身份或用户登录凭据。只用原站浏览器包公开发布的 publishable 应用标识，不使用 secret key、不访问后台或绕过登录与拒绝。
- 严格检查链接站点和路径、剧集和番剧 ID、线路 ID / code、地址期限、HTTPS CDN 域名、端口与视频格式。响应上限 64 KiB，403 / 429 等结果不会轮换身份或自动重试。保留原站签发地址，不修改其中参数。
- 页面识别成功后，先用静音的临时播放器实际加载首帧，再发布房间媒体；此过程与识别共用 15 秒截止时间。加载失败、取消、换片、离线与迟到结果保持当前影片，释放临时播放器及网络资源。接口 200 不再直接等同于可播放。
- 原站实际可能返回 `play.xfvod.pro:8088`。Node 自建服务只为该 HTTPS 域名放行此媒体端口，显式传入的端口限制仍优先，DNS 公网检查和固定解析地址连接保持；其他域名、凭据和私网端口不开放。Cloudflare 不启用原站 HTTP 视频代理。
- 蜜柑 Node 与 Worker 使用相同、明确标识本应用的兼容请求头，尚未据此宣称 403 已修复。界面与 README 将蜜柑标明实验识别。原有共享画面、本地视频和客户端原站控制保留。

## 已完成验证

- `npm run verify`：46 项测试、格式、前端 / Node 类型和构建、Worker 类型和 dry-run 通过。新增测试覆盖匿名请求不带房间凭据、剧集 / 线路 / 期限 / CDN 校验、拒绝与限频不重试、响应大小和取消。
- 稀饭完整原站页面的本地端到端：约 11630 ms 完成识别及首帧检查，两端均实际解码 1920×1080 和音轨，暂停、5 秒进度、1.25 倍速一致。识别取消与失败保留当前影片；模拟接口 200 但视频加载失败时没有发布换片。该项使用既有 Node HTTP 媒体代理，证据在 `.local/xifan-playback-local-evidence.json`。
- workerd 与 Pages Service Binding 验证通过：元数据鉴权与解码、2 MiB 原图保存及休眠恢复、聊天和成员恢复、二进制画面转发与隔离、停止清理；原站 HTTP 视频代理仍关闭。该项上游使用生成样片，不代替真实网站可达性验证。
- 稀饭正式入口完整验收两次通过，均采用系统默认网络、两个存储隔离的浏览器会话，不设置站点绕行或专门代理。识别及首帧检查分别约 5436 / 7011 ms；最终两端 1920×1080，解码 102 / 138 帧与音轨，直接从 `play.xfvod.pro` 播放，没有原站 HTTP 视频代理或画面捕获。暂停、5 秒及 1.25 倍速同时核对服务端权威状态和两端播放器；取消、错误及“接口 200 但视频失败”均未换片，无页面错误。证据在 `.local/xifan-playback-public-evidence.json`，实际截图已目视确认。
- 完善验收脚本：进度条用一次明确的 change 事件提交，避免 `fill()` 后再次 dispatch 导致两个相同人工操作；同时检查服务端确认状态，防止只根据本地控件值下结论。
- **蜜柑仍未修通**：最终部署后的默认网络、隔离双会话复验仍失败，识别接口返回 422 / 原站响应超时（12 秒），没有发布共同播放。此前本轮先复现的是读取页面 HTTP 403；统一请求头没有成为已修好的证据。最终失败证据在 `.local/mgn-playback-recheck-public-evidence.json`。不要求用户继续刷新来证明这条路径可用。
- 验收命令为 `npm run test:site-source -- "完整原站链接"`，原有 `test:mgn-playback` 保留。正式入口通过 `VS_PUBLIC_URL` 指定；记录是否使用专门代理配置，以及观众存储是否与提供者隔离。不把网络特设或同机页面验收当作用户异地实测。

## 部署与正式服务

2026-10-19 02:16（北京时间）核对 https://videosreeeen.pages.dev ：

- 运行时提交：`8ab931323cd2a388f9ebb0c5d181130fe541c373`。
- Worker：`507fd84d-e9c5-4bab-bdb4-241bf4cbd489`。
- Pages：`ceca4530-40ce-4ae5-be8d-6648a4a904c6`，提交与运行时一致。
- 活跃 JS：`index-D7HiSZsD.js`，SHA-256 `f43895e98d73f6ab413f2cfb64313753db93747da6f256a4c6cf329b7940a766`。
- 活跃 CSS：`index-alx5V5Wp.css`，SHA-256 `51df51c3be268a41c3eebe70a458311e51f53ce150153a1097fc826abb204c18`。

HTML 和活跃 JS / CSS 与本地构建逐字节一致，健康接口正常。证据在 `.local/public-web-source-evidence.json`。本轮部署网页与房间服务，没有重新发布 Windows 安装包或 Android APK，未安装任何设备；同机正式网络浏览器验收也不冒充用户异地或 Safari 真机验收。

## 依据

- 两个原站的正常匿名播放网络、稀饭客户端公开脚本中的正常接口调用和公开响应结构；原始响应、视频地址与视频字节不进入仓库。
- [Supabase API key 类型](https://supabase.com/docs/guides/getting-started/api-keys)：publishable 标识用于公开客户端，权限仍由原服务的匿名 / 登录授权决定，不能当作 secret 或用户登录凭据。
- [Cloudflare HTTP 520](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-520/)：浏览器能打开原站不等于服务器出站可读取，不用调整提示来冒充连通性已解决。
