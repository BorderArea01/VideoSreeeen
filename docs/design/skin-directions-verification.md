# 2026-10-31 四版故障风格预览验证

当前预览：[四版动态对比](https://cd4e699b.videosreeeen.pages.dev/board.html)、[完整交互](https://cd4e699b.videosreeeen.pages.dev/index.html)。固定入口 [skin-directions](https://skin-directions.videosreeeen.pages.dev/board.html) 指向同一新版。Pages 预览分支 `skin-directions`，部署 `cd4e699b`，实现提交 `ab6b7e7`，源码分支 `codex/skin-directions-20261031`。

![四版实际浏览器截图](skin-directions-overview.png)

用户纠正要求为：破碎只在边缘约 10%–20% 区域，按钮和容器轮廓可识别。本版将外围环形带限制为总面积约 15%，内部约 85% 保持连续完整；并为边缘附近的文字保留完整底色。不能把每边都切 15% 当作总面积切 15%。横向碎条、照片拉伸、轻微 RGB 偏移和漂浮碎块集中在外围；影片画面及真实文字不参与装饰变形。A 像素断流、B 悬浮碎层、C 数据熔合、D 错帧崩解保留不同边缘密度、材质及展开方式。全幅切碎的中间候选已被本版取代。

## 验证结果

通过受控入口运行 `scripts/skin-directions-check.mjs`，本机及当前公网预览检查均通过。公网证据 `.local/skin-directions-public-evidence.json`，时间 `2026-10-30T18:57:47.470Z`（北京时间 2026-10-31）。

- 四方向在动效展开时抽查容器主体 7,811 个像素位置，中心破损数均为 0；主体完整面积比例约 0.85，外围仍有真实透明断口。源面板边缘切片密度分别为 46 / 23 / 36 / 28，按钮边缘 13 层；这些数字指边缘绘制分层，不能解释为整面切碎。
- 背景经过处独立演变、结束后稳定；按钮悬停与点击反馈、演示聊天输入正常。四版对比页可同时播放一次动效。
- 320 / 390 / 1440 / 2000 像素布局、背景覆盖、减少动态效果和不产生横向滚动通过。实际截图已目视检查；窄屏为桌面 Edge 视口，不代表手机真机验收。
- 所有浏览器请求限于预览同站点，没有真实房间、麦克风、视频源或第三方请求。

已逐项核对公网 index、board、CSS、JS、WebP 和 README 共 6 项资源 SHA-256 与本地一致，回执 `.local/skin-directions-public-assets.json`。JS `038905879151e681f0bba9267d844fd38c75a1a5df2ab775aadd52af1a45686b`；CSS `43a7444f8de1b214de5402d8a32698702aa3ede199447b18bcbe6aebbe54a054`。

## 正式版本与资源

只更新独立原型及其文档、截图、验收脚本。`client/`、`worker/`、`server/`、发布工作流、安装包和 Release 均未修改。核对正式入口仍引用 `assets/index-ByAASs3a.js`。未推送 main、创建 PR、触发客户端发布或更新真实房间；方案待用户选择。

继续使用已有 [sky.webp](skin-directions/sky.webp)，102,094 字节，SHA-256 `bf96b7665a8227b526d4acf76e2dd62b761c7249c0b82543850ea2df21bdfda8`。素材由此前内置 image_gen 生成，完整提示词与设计说明见 [README](skin-directions/README.md)；本轮未新增位图、安装包、构建目录或回退版本。现有截图原位更新，已删除失败布局的旧诊断截图；本组当前截图约 7 MiB，原始素材与唯一回退清单保留。
