# 2026-10-31 四版 CSS 故障艺术方案

用户要求推翻旧实现，以 Dragonir 的 [CSS 故障艺术文章](https://www.cnblogs.com/dragonir/p/14878001.html)为第一参考，更换色调，完成四版后选择。本轮只做独立方案，未选择或接入其中一版到正式观影页面。

## 实现

源目录为 `docs/design/article-glitch`：独立 HTML / CSS、少量只负责触发有限动画和本机交互的 JavaScript。没有导入现有 A 版的 Canvas、纹理条块和指针跟随实现。背景分层、按钮整体副本切片、`clip-path` 与阶跃位移均为真实网页效果；四套变量、标题、面板形状、排版和动效节奏分别定义。

四版与实际截图、参考落实和复现入口见 [方案说明](design/article-glitch/README.md)。

## 自动与目视验收

通过受控入口串行运行 `scripts/article-glitch-check.mjs`，每次只启动一个隔离 Edge 上下文，结束关闭所属浏览器与本机服务器。

- 四个 URL 正确选择 A / B / C / D，配色分别不同；截图来自实际 HTML 页面。
- 鼠标悬停使按钮副本实际出现 `control-cut` 动画，使用 `steps(2)`；包含原文字，带图标按钮包含同一 SVG。装饰副本不能截获点击。
- 实际移动鼠标到容器边缘、空白背景会触发相应层；结束后，即使指针仍停留也没有运行中的动画。
- 视频表面位于全部边缘碎片之上，不会因边缘动画遮住影片。
- 系统“减少动态效果”和本页动效开关均能关闭全部动画。
- 聊天加长后内部滚动，面板高度不变；输入 `<img src=x>` 作为文字显示，不生成图片节点。
- 播放方式按钮、键盘方向切换、聊天收起 / 展开、语音样式面板和预览提交提示可操作。
- 四版实际解码本机 CC0 视频为 960 × 540，能开始播放；该样片分辨率仅属于设计页示例，与产品 B 站取流无关。
- 桌面 1440 像素、窄屏 390 / 320 像素没有横向溢出；这属于桌面浏览器视口检查，未宣称手机真机验证。
- 没有页面脚本异常，没有 WebSocket / 房间 / 语音请求，不申请麦克风或屏幕权限。

本机完整结果覆盖写入 `.local/article-glitch-verification.json`，当前动态帧与窄屏截图覆盖写入 `.local/screenshots/article-*`，不累计历史构建。

## 构建与部署

静态构建为 `.local/article-glitch-dist`，11 个文件、3.15 MiB，无 Worker、Service Binding、Functions 或房间服务。使用同一已授权免费 Pages 项目，仅更新 `article-four` 预览分支。

- 固定部署：[c48295d5.videosreeeen.pages.dev](https://c48295d5.videosreeeen.pages.dev/board.html)。
- 四版入口：[article-four.videosreeeen.pages.dev/board.html](https://article-four.videosreeeen.pages.dev/board.html)。
- 公开四版浏览器交互复验通过。样片请求在浏览器检查中替换为同一份本地 CC0 文件；该检查证明已部署播放器能够解码与播放，不代表各地到 MDN 的网络均畅通。
- 全部 11 个公开文件逐一 SHA-256 对上构建产物，包括 HTML、CSS、JS、原照片和四张截图。Pages 会把 `.html` 地址重定向为无后缀地址，核对使用跳转后的完整响应；未忽略或篡改响应差异。
- 正式页面入口仍为 `assets/index-ByAASs3a.js`，没有部署正式分支或房间 Worker，没有发布客户端或触发 Release 工作流。

精确哈希、部署 URL 与检查时间见 [当前部署回执](design/article-glitch/deployment.json)。

产物检查：本轮仅保留一份当前方案构建，源码中的四版截图是用户要求的对比交付物，不是四份回退包。项目唯一回退仍由 `.local/rollback/manifest.json` 定位，本轮未增加回退版本或安装包。结束时 D 盘剩余约 45.49 GiB，无新增大型编译中间目录。

## 边界

这是可以体验的四版视觉方案，不是真实多人观影验收。样例聊天不代表用户，样片是本机播放。用户尚未选择最终方案；本轮不发布客户端、Git 标签或 Release，也不触发客户端 Actions。
