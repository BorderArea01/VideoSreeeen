# 2026-10-31 全新四张故障艺术视觉稿交付

方案页：[四版大图对比](https://c8759cda.videosreeeen.pages.dev/)。Pages 预览部署 `c8759cda`，分支 `skin-directions`；固定入口 `https://skin-directions.videosreeeen.pages.dev/` 同步指向本轮方案页，旧 `/board.html` 跳转到方案页。源代码分支 `codex/skin-directions-20261031`，实现与图稿提交 `a90f731`。

用户要求全部推翻旧候选，重新生成四个风格不同的版本。本轮从空白生成 A 天光断层、B 暮色熔帧、C 风暴碎页、D 极夜回声，分别使用晴昼瓷白钴蓝、落日暖铜深紫、风暴石墨银白、极夜墨色薄荷；布局、材质、光线和破碎方式均分别设定。没有使用旧 B 稿作为生成参考。

## 产物与边界

- 四张定稿位于 [glitch-concepts](glitch-concepts/README.md)，均为 1536 × 1024 PNG，共 10,153,436 字节；实际文件清单和 SHA-256 见 [manifest.json](glitch-concepts/manifest.json)。本轮生成首稿已由定稿原位替换，目录只保留四个当前候选。
- 使用内置 image_gen，四个独立生成请求，逐稿定向编辑修整视频边缘、主按钮破碎与 D 版重复入口。完整 [生成提示词](glitch-concepts/README.md) 和 [定稿编辑提示词](glitch-concepts/EDIT-PROMPTS.md) 均已记录；没有 CLI/API 回退。
- 图稿已目视检查：保持明显横向材质撕裂、像素拉伸、漂浮碎片及轻微色偏；正文与按钮中心清晰，修整后的电影区域保持完整。图中文字、头像和控件是视觉稿示例，不是实时房间或真实播放器状态。
- 本轮是静态视觉方向选择，尚未实现图中动效或交互，没有更换正式网页、Worker、客户端、安装包或 Release。

## 检查与部署

四张 PNG 的签名、尺寸、所有 PNG chunk CRC 与内容唯一性通过检查。隔离 Edge 本机及公网检查均通过：四张原图解码为 1536 × 1024；1440 / 390 / 320 像素布局无横向滚动；所有请求限制为方案站点，没有真实房间或第三方请求。实际桌面及窄屏页面截图已目视检查；窄屏不代表手机真机或真实视频播放验收。

公网 8 项资源（4 张 PNG、HTML、两份提示词文档、manifest）的 SHA-256 与本地一致，旧 `/board.html` 重定向检查通过。正式入口继续引用 `assets/index-ByAASs3a.js`，未因方案页部署改变。检查回执 `.local/glitch-concepts-local-evidence.json`、`.local/glitch-concepts-public-evidence.json`、`.local/glitch-concepts-public-assets.json`。

只推送方案分支，不推送 main、不创建 PR、不触发客户端发布。旧候选的 13 张可重新生成的本机截图已清理；源代码、原始生成素材、用户数据和项目唯一回退版本保留。
