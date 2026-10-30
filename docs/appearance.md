# 界面皮肤与 Glitch Art 素材

## 使用

点击顶部调色盘，或打开「设置与帮助 → 界面皮肤」。目前提供两款：

| 皮肤                  | 样式                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| 暖夜 · 原版           | 现有深灰、暖橙配色                                                                       |
| 晴空故障 · Glitch Art | 蓝天白云照片基底、横向像素排序和 datamoshing 风格损坏、浅青按钮、轻微 RGB 色偏与漂浮碎块 |

没有手动偏好时，页面第一次打开随机选择；同标签页刷新或历史恢复维持分配结果。新导航不沿用从 opener 复制来的随机分配。点击皮肤卡片即固定选择并保存在本机，即使点击的正是随机分配的同款也能固定；「随机选择」清除固定偏好并重新分配。存储被禁用时仍可切换，只是无法保证跨刷新记忆。

皮肤不属于房间状态，不发房间操作，不改变别人外观，不重建播放器，不自动开启麦克风、缓存或画面共享。按钮文字、点击区域和视频保留完整；故障碎片来自独立、不接收点击的 CSS 装饰层，不复制交互控件或聊天室内容。

背景由独立 Canvas 绘制：蓝天照片是基底，鼠标经过时实时重采样局部水平条带、拉伸错位，并生成 RGB 条纹和漂浮像素。窗口尺寸、DPR 和 visual viewport 改变时重建铺底，不依赖仅覆盖文档部分区域的 fixed CSS 图片；画布始终覆盖可见窗口。上限 240 万像素、DPR 1.5、交互时最多 30 帧/秒，鼠标停止约 1.1 秒后停止逐帧更新。

按钮在悬停期间持续运行水平条带和碎片动画，离开即恢复，不改变文字或点击范围。系统启用减少动态效果时关闭背景交互和按钮动画，触屏保留静态装饰。切回原版释放画布 backing store；页面隐藏、系统全屏和网页全屏停止动态背景，正文使用深蓝面板承托，不给影片或字幕添加损坏效果，也不采样视频或第三方页面。

## 素材与生成提示词

- 使用内置 `image_gen` 生成背景，不使用 CLI/API 备用路径。项目资源：`client/assets/themes/glitch-sky.webp`，267,878 字节；页面通过 Vite 资源哈希引用，不依赖外部图片站。
- 原始 PNG 为 2,330,753 字节，保留在本机生成图片目录；仅转换 WebP 格式用于网页，未改变构图或色彩。背景是生成素材，界面按钮、图标和横向碎片以 HTML / CSS 实现；影片不来自生成素材。
- 此资产用于本 GPL-3.0-only 项目，无第三方照片或品牌素材。生成过程没有使用用户房间截图、账号资料或视频画面作为输入。

实际生成提示词：

```text
Create one production website background asset, landscape 16:9, high detail. Use-case: stylized-concept. A photorealistic clear blue daytime sky with natural sunlit white cumulus clouds, cinematic photographic base, then strong Glitch Art digital file corruption: horizontal pixel sorting, stretched scanline tears across cloud edges, datamoshing fused blue/white rectangular streaks, scattered tiny floating pixel squares and subtle RGB channel displacement. The horizontal tearing should be visually assertive around the upper and lower edges while the central sky remains quieter so real HTML interface panels can sit over it legibly. Natural daylight, brilliant azure blue and white, small cyan/magenta artifacts, fine photographic cloud texture, premium high-detail cinematic image. No text, no letters, no logos, no watermark, no depicted interface, no fake buttons, no people, no buildings. This is the photographic background only; functional UI buttons will be implemented separately in code.
```

## 验证

`npm run build` 后经受控入口运行 `npm run test:appearance`：独立无头 Edge、新房间、MDN CC0 MP4 fixture 和实际房间 WebSocket。测试以确定性的随机数边界驱动两种分配，不修改服务端 RTT 或模拟成员。

- 两款首次随机分配、刷新稳定、opener 会话副本不锁定新标签页。
- 手动固定同款和不同款、后续标签页记忆、恢复随机、方向键切换、存储禁用仍可使用。
- 双端播放中换皮肤：原 video 元素和地址保留，没有 loadstart、暂停或房间控制消息；另一端外观不变，聊天正常。
- 网页全屏仍保留原播放器；减少动态效果无动画，装饰不接收指针事件。
- 系统强制颜色模式下隐藏装饰背景，选择卡片仍以勾号标明当前皮肤。
- 通过鼠标扫描前后的真实画布像素变化核对交互，停止后像素稳定；按钮悬停的实际 transform 持续变化。2560×1440 和 800×1100 画布覆盖边缘，浏览器模拟 1.5 倍 visual viewport 缩放截图验证，未以静态背景图替代互动实现。
- 1440px 桌面与 390px / 320px 窄屏、设置面板截图已目视检查，无横向溢出。均为桌面 Edge，**不代表 Android / iOS 真机验证**；测试不访问用户麦克风、当前房间或设备。

本机证据 `.local/appearance-evidence.json` 与 `.local/screenshots/theme-*.png`。README 预览为上述隔离房间，不包含真实用户邀请或账号信息。

`npm test` 的 116 项测试与 `npm run test:player-controls` 通过；后者实际验证暂停、跳转、预览、精细定位、HLS 预览、网页 / 系统全屏和闲置隐藏。前端构建、格式及类型检查另经受控入口执行，未重新发布客户端。

## 部署记录

本轮只计划更新 Pages 静态网页，不更新房间 Worker、Durable Objects、客户端安装包或 Release；正式部署与公网复核后补记产物。

实现参考：[sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)、[减少动态效果](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)、[CSS 装饰伪元素](https://developer.mozilla.org/en-US/docs/Web/CSS/::after)。没有引入 UI 动画依赖或后台定时动画。
