# 2026-11-01 全屏焦点恢复误唤出控制栏

用户反馈网页全屏和系统全屏观看时，偶尔自动选中全屏按钮，随后底部进度条重新出现。旧版 `FullscreenIdle` 将任何 `focusin`、窗口 `blur` 与所有按键都当成唤醒，并把按键留下的键盘模式持续用于保留控件。恢复按钮焦点会直接取消隐藏；焦点带有 `:focus-visible` 时还可能一直阻止闲置隐藏。重复但没有位移的鼠标事件也会重置计时。

修订前运行源码 `fadb66c` / 主脚本 `index-GXGkG51m.js` 在独立播放房间可复现：网页全屏约一秒隐藏后，仅调用全屏按钮的 `.focus()`，控制栏立即退出隐藏，断言失败。记录 `.local/fullscreen-focus-before.json`。该复现证明应用将被动焦点错误当成用户操作，不等于已验证用户实际操作系统上每一种焦点恢复来源。

## 修订

所有行为仍集中在 `client/fullscreen-idle.ts`，不往主题、按钮或播放器追加独立隐藏规则，不改变原有全屏布局与 CSS 焦点样式。

- 将显示控件与重新安排闲置检查分开。被动焦点恢复、焦点离开、窗口失焦与可见性变化只安排检查，不重新显示已经隐藏的控件。
- 只有 Tab 或控件上的方向 / Home / End 操作才保留键盘导航状态；修饰键、系统媒体音量键及组合快捷键不误判成播放器导航。Escape 在菜单处理前参与闲置状态更新，关闭菜单后不因恢复到 summary 而永久保留底栏。
- 全屏模式变化、窗口失焦清除过期的交互状态；真正的鼠标移动或按下仍唤醒，完全相同坐标和指针类型的 move 不唤醒。pointercancel 释放按住状态，不制造额外唤醒。
- 真正键盘导航、暂停、拖拽进度、打开的设置 / 对话框以及侧栏输入继续保留控制栏。普通观看约一秒后隐藏，并释放非键盘导航留下的被动按钮焦点；不全局禁用焦点或移除键盘可访问性。

## 验证

`npm run test:fullscreen-focus` 使用静音的独立 Windows Edge 浏览器与测试房间，暖夜 / 天光 / 紫电 × 网页全屏 / 系统全屏共 6 组通过：焦点恢复不唤醒、窗口 blur 与焦点恢复事件不唤醒、相同坐标不唤醒，实际移动会显示；真实 Shift+Tab 仍显示和保留键盘焦点，Enter 打开设置及 Escape 关闭后恢复隐藏；暂停保持可操作，退出全屏正常。所有焦点与布局操作不发送房间媒体 / 控制 / 缓存指令，原视频节点不变且 `loadstart` 为 0。

该测试实际请求浏览器系统全屏并使用键盘事件导航；窗口失焦场景在测试浏览器注入 blur 与恢复焦点，不伪称已验证用户物理 Alt+Tab 或系统弹窗。视频为公开测试片，物理音频静音，没有进入用户正在观看的房间。没有 Android / iOS 真机结论。

构建与 TypeScript 检查通过，最终 6 组另行确认控制栏实际 CSS 透明度为 0，截图经目视检查。原有 `test:player-controls` 回归通过，包括无 CORS MP4 画面预览、上拖精细跳转且只提交一次、10 / 30 / 60 / 90 秒跳转、HLS 预览、窄屏与模拟触摸；旧普通点击路径测得隐藏耗时约 994 ms。

正式发布结果另存后续记录。测试源码在 `scripts/fullscreen-focus-check.ts`，原始记录在 `.local/fullscreen-focus-evidence.json` 与 `.local/player-controls-local-evidence.json`；所有任务经受控入口串行执行，不更新房间 Worker 或强制刷新用户页面。

参考：[focusin 的触发与冒泡](https://developer.mozilla.org/en-US/docs/Web/API/Element/focusin_event)、[浏览器的 focus-visible 启发式](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:focus-visible)。
