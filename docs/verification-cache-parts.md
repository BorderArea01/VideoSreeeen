# 分批缓存与目录设置（2026-10-30）

2026-10-31 新增依据真实视频索引的逐批删盘和灰色不可跳转范围，详见[缓存清理与房间恢复](verification-room-resilience.md)。旧版分批房间不自动切换规则，下面保留首版的验证基线。

保留默认关闭的共同缓存入口和原有完整下载模式，增加首批 1/2、1/3 的可选模式。按 256 KiB 块划分文件字节，每个音视频轨道均需完整提交首批块与 MP4 初始化信息；服务端比较累计内容指纹才允许开播。后续后台继续下载，播放器从本机已落盘块读取，未到达的块等待下载；不重新编码，不通过房间 WebSocket 传视频，不启用原站服务器代理。

字节比例不等于片长比例，块对齐也可能超过名义比例。持续低带宽或拖到未下载位置仍可能卡顿。HLS 和旧 Android 客户端暂保留完整缓存；分批能力握手、媒体和缓存代次检查防止旧客户端错误放行。

网页通过系统目录选择器保存用户授权的句柄，不读取或伪造绝对路径。指定目录使用应用自己的分块文件，避免把影片搬回浏览器默认盘或拼接成同样大的内存数组。Windows 源码优先 D 盘、系统选择其他目录、配置持久化、每个应用配置独立命名空间；指定磁盘失效不静默回落系统盘。旧的正式 0.4.6 客户端发行资产保持不变。

## 本地验收

- `npm run test:cache-parts`：两份独立浏览器资料，960×540 CC0 测试片；故意阻塞后续分块，两端仅落盘 524,288 / 1,128,375 字节时已解码并播放，随后恢复并完成全部下载。取消清理、完整缓存回归与刷新后目录记忆通过。
- `VS_CACHE_PARTS=2 VS_CACHE_NO_RANGE_HEADERS=1 npm run test:cache-parts`：不公开 Content-Range，经 HEAD 获取总大小、正常完整 HTTP 响应顺序写盘；两端缓存 786,432 字节后播放，之后完成缓存。没有把未验证的范围响应当成块。
- `tsx scripts/cache-location-check.ts`：实际 Electron 源码壳，独立配置资料；默认真实 D 盘、通过系统对话框接口选中测试目录、缓存未完整时本地解码 960×540、完成后清理、保留旁边用户文件、重启后保留目录设置通过。测试替换目录对话框返回值以避免操作用户桌面；不是安装包验收。
- 单元测试覆盖尾部 moov、全员内容一致性、后续指纹不一致、低进度伪报、旧版本、换代、断线、目录隔离、Range 和取消。原有完整缓存门槛保留。

原始脱敏证据保存在忽略目录 `.local/cache-parts-3-evidence.json`、`.local/cache-parts-2-sequential-evidence.json`、`.local/cache-location-native-evidence.json`；截图 `.local/screenshots/cache-parts.png`。目录选择器的跨重启网页权限仍由浏览器决定；没有宣称手机真机、跨运营商长期播放或实际番剧下载已通过。

参考：[Chrome 文件系统访问 API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)、[Service Worker fetch](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/fetch_event)。
