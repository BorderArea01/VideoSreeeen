# 稀饭 AL 新番线路共同播放（未发布）

2026-10-20。用户提交 `https://next.xifanacg.com/anime/3434/play/203799?source=AL`，界面提示仅支持 xfy2。原因是网页识别入口只接受 `source=xfy2`，并固定请求线路 5；AL 在读取播放接口前即被拒绝。

## 调查与实现

- 在全新浏览器资料中访问用户提供的原站页面，观察原站正常发出的公开 `issue-web-playback` 请求：`action=fallback`、`episode_id=203799`、`source_id=1`。响应包含相同番剧、剧集和 `source_code=AL`，视频位于既有 `play.xfvod.pro:8088` CDN。
- 按原站实际映射支持 xfy2 → 5、AL → 1，不自动改换用户线路。保留匿名跨域读取、无 Cookie、无房间身份、响应大小、取消、过期、剧集、线路和 CDN 校验。未知线路、重复 source 参数、错线路结果继续拒绝。
- 下一集页面元数据白名单允许大写线路代码；仍限定原站路径、单一 source 查询和同番同线路。房间服务不代理视频，首帧检查失败不发布新媒体。
- 网页能力文案更新为 xfy2 / AL。未修改共享画面、登录会话或缓存门槛。

## 本地实播证据

`npm run verify` 通过：62 项测试、格式、构建、Worker 类型检查和部署 dry-run。AL 用例检查了真实线路请求格式、错线路、重复 source 与未知线路拒绝；下一集用例检查 AL 路径白名单与不允许串线。

在受控入口运行：

```powershell
$env:VS_TEST_DIRECT_MEDIA='1'
$env:VS_TEST_NEXT='1'
$env:VS_TEST_RECOVERY='1'
& ./scripts/controlled.ps1 -File node.exe -Arguments @('--import','tsx','scripts/site-source-check.ts','https://next.xifanacg.com/anime/3434/play/203799?source=AL') -AllowGameThisRun -MinFreeMiB 0
```

测试使用两份独立 Edge 浏览器资料、本地真实房间服务和真实原站播放接口；仅将本地 `/config` 的 `mediaRelay` 设为 false，以核验与 Cloudflare 相同的视频直连方式。未拦截或替换成功路径的视频请求，两端 `currentSrc` 均为原 CDN，未走 `/media` 视频代理、屏幕采集或转码。

| 项目                     | 实际结果                                               |
| ------------------------ | ------------------------------------------------------ |
| 来源识别与首帧           | 约 7 秒后发布                                          |
| 双端解码                 | 1920×1080；199 / 168 帧；音频解码 212432 / 188128 字节 |
| 原视频时长               | 1708.352 秒                                            |
| 播放中跳到 30 秒         | 无需暂停再播放，两端继续出帧                           |
| 观众断网 3.5 秒后恢复    | 无需房间暂停再播放，继续出帧                           |
| 暂停、进度、倍速         | 两端暂停于 5 秒、1.25 倍速，与权威房间状态一致         |
| 取消、接口失败、首帧失败 | 保留当前视频，不发布迟到或无法播放的结果               |
| 下一集                   | 原站给出 `203800?source=AL`，两端换片并继续解码        |
| 页面与房间错误           | 无                                                     |

同样以视频直连方式回归原 `151/play/1986?source=xfy2`：两端仍为 1920×1080 并解码音频，播放中拖动、暂停于 5 秒、1.25 倍速、失败保留当前视频及真实下一集 `1987?source=xfy2` 均通过。

脱敏运行摘要保存在忽略目录 `.local/xifan-al-playback-evidence.json`，不提交原始站点响应、临时视频地址或视频文件。未完成异地网络、Android / iOS 真机验收。此处为本地开发构建，未创建 Release、未打包安装程序、未部署线上服务；不能将本地结果称为线上已修复。
