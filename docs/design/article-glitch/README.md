# 四版 CSS 故障艺术重写方案

这是供选择的独立 HTML / CSS 交互方案，不是正式放映厅更新。不连接房间，不申请麦克风、屏幕共享或文件权限；聊天室中的初始消息明确标为样例。发消息只在本页内存中演示，刷新即清空。播放器使用本机播放的 MDN CC0 样片，没有模拟在线人数、RTT 或同步进度。

**[打开四版对比](https://article-four.videosreeeen.pages.dev/board.html)**，点击任一版进入实际交互页面。静态截图只展示配色，鼠标掠过后的动画请在单版中体验。

![四版实际网页截图](overview.jpg)

| 方案         | 配色与材质                                             | 动态区别                                   | 交互预览                                                        |
| ------------ | ------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------- |
| A · 硫黄脉冲 | 硫黄、碳黑，品红与冰青侧影；斜切按钮与高对比大色块     | 820 ms，较大的突然横移，硬切与清晰间歇交替 | [打开 A](https://article-four.videosreeeen.pages.dev/?scheme=a) |
| B · 薄荷断讯 | 薄荷白、墨绿，酸橙侧影；较轻字重、圆形头像与更松的留白 | 980 ms，较小位移，短促断讯后恢复           | [打开 B](https://article-four.videosreeeen.pages.dev/?scheme=b) |
| C · 紫电残像 | 紫黑、电粉，青蓝重影；折线缺口、紧凑的双行控制台       | 720 ms，更快的两轮撕裂、更强的横移         | [打开 C](https://article-four.videosreeeen.pages.dev/?scheme=c) |
| D · 锈红银幕 | 暖银、锈红，冰青色偏；金属渐变面板、衬线标题与下沿缺口 | 900 ms，长短条切换，金属底色与冷色重影错开 | [打开 D](https://article-four.videosreeeen.pages.dev/?scheme=d) |

## 参考如何落实

第一参考是 Dragonir 的 [《仅用 CSS 几步实现赛博朋克 2077 风格视觉效果》](https://www.cnblogs.com/dragonir/p/14878001.html)，并结合 [MDN clip-path](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/clip-path)、[MDN steps()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/easing-function/steps) 核对浏览器行为。没有复制原文完整代码或其图片；下列页面、切片坐标和动画时序为独立实现。

- 按钮：纯文字按钮使用 `::after`；带图标按钮使用包含同一图标、文字、间距与底色的装饰副本。副本用 `clip-path: inset()` 切片，再通过 `steps(2, end)` 突然错位，字与按钮表面一起移动。
- 背景：同一张清晰照片叠为多层，使用 `clip-path: polygon()`、混色与离散平移。没有固定故障图块，没有放大模糊滤镜，没有坐标持续跟随鼠标。
- 容器：面板材质的裁切副本集中在左右边缘约 12% 的区域，带深浅反差和色偏；主体布局和点击区域不变。影片层始终高于全部碎片，边缘效果不覆盖视频。
- 触发：划过按钮、容器边缘或空白背景触发有限 CSS 序列；每次结束后恢复，无常驻循环，不使用弹簧、缩放回弹或旧 Canvas 绘制引擎。移到后台立即清理，支持关闭动效与系统“减少动态效果”。

## 可操作范围

四版都可以切换样式、收起聊天、在本页发送预览消息、切换播放方式输入面板、展开语音样式面板和播放样片。链接提交会明确说明这是设计预览，不会真的取源或同步到房间。样片加载需要访问 MDN；失败不影响比较样式和动效。

正式播放器、房间同步、缓存、扩展和语音实现未在此分支预览中替换。选定版本后再接入真实功能，不把视觉预览当作共同播放验收。

## 复现

在仓库根目录通过受控入口串行执行：

```powershell
./scripts/controlled.ps1 -File node.exe -Arguments @('scripts/article-glitch-check.mjs') -AllowGameThisRun -MinFreeMiB 0
./scripts/controlled.ps1 -File node.exe -Arguments @('scripts/build-article-glitch.mjs') -AllowGameThisRun -MinFreeMiB 0
```

浏览器检查使用已安装的 Edge 和已有 `.local/flower.mp4` CC0 验收样片；不启动用户浏览器，不操作真实房间。截图固定覆盖为 `a.jpg` 到 `d.jpg` 和 `overview.jpg`，构建只覆盖 `.local/article-glitch-dist` 一份当前方案产物。源照片复用 `client/assets/themes/daylight-sky.png`，不额外复制四份。

样片缩略图 `poster.jpg` 从 MDN CC0 `flower.mp4` 的第 2 秒提取，视频文件不提交、不打包；预览播放器按用户点击从 MDN 原地址加载。天空照片为本项目已有生成素材。代码沿用仓库 GPL-3.0-only。

具体验证与部署记录见 [本轮验收](../../verification-article-glitch.md)。
