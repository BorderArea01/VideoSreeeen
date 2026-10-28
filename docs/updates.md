# 客户端分发与更新

发布入口为本仓库的 GitHub Releases。网页设置中的“版本与更新”提供 Windows 安装版和 Android APK；不要求使用者下载源码或查找 Actions 构建产物。

2026-10-27 已确认公开分发恢复：v0.4.4 的 7 个资产均经过匿名完整下载和摘要校验，`releases.atom`、Windows `latest.yml`、Android `update.json` 可公开读取且与发行包一致。入口为 [最新版本](https://github.com/BorderArea01/VideoSreeeen/releases/latest)；此前 404 的调查及恢复范围见 [公开访问记录](github-access.md)。

2026-10-28 实际 Windows 0.4.5 成品使用隔离资料检查 GitHub 公共更新源，已返回“当前为最新版”；7 个公开发行文件已完整读取并核对摘要，详见 [0.4.5 发行验证](verification-bilibili-account.md)。更新器检查没有执行安装，不能代替真实旧版本覆盖安装验收。

Windows 安装版使用 Electron Builder NSIS 与 electron-updater，生成 `latest.yml`、安装包及差分 blockmap。应用自动检查版本，下载和安装由使用者点击；安装时退出应用，保留用户设置。不在退出时悄悄安装。便携版继续提供，首次需安装安装版才能使用其后续应用内更新。

Android 从固定仓库的 `update.json` 获取版本号、单调增加的 versionCode、文件大小及 SHA-256；下载到应用自己的更新目录，核对包名、版本及当前应用签名后才交给系统安装器。只允许 GitHub 及其 HTTPS 资产域名重定向，包大小上限 128 MiB，临时文件失败后清理。Android 首次需要允许“此应用安装未知应用”，每次安装仍需要系统确认；不需要先卸载旧版。

首个正式签名 APK 与之前的 debug APK 签名不同，不能直接覆盖。不能为了换签名自动卸载已有应用或清除其数据。后续所有正式版必须沿用同一签名，版本码递增。

## 维护者发布

1. 修改 package.json / package-lock.json 的版本、Android versionName / versionCode、服务健康版本与发布说明；完成测试和产物检查。
2. 本机按受控入口构建 Windows 和 Android 发布包。APK 使用 `scripts/build-android.ps1 -Release`，不安装到任何设备。
3. 提交并推送对应源码，然后运行 `npm run release:prepare`，在 `artifacts/release/<版本>/` 生成两端包、Windows 更新元数据、Android 更新清单与校验和。
4. `npm run release:publish` 核对主分支提交和清洁工作树，先创建草稿并上传完整文件，确认全部资产的大小和服务端 SHA-256 后才公开。已公开版本不覆盖；失败保留草稿，同一提交且已有文件摘要一致时可继续上传缺失文件，不替换已有资产。

只更新已有 Release 的介绍或下载说明时，编辑 `docs/release-notes.md`，通过 `gh release edit <标签> --notes-file docs/release-notes.md` 更新正文；不重新执行发布脚本，不覆盖资产或移动标签。正文修改后再核对公开页面和下载入口。

Android 发布需要 `VS_ANDROID_KEYSTORE`、`VS_ANDROID_STORE_PASSWORD`，别名 `videosreeeen`。本机的固定签名保存在工作区之外的 `D:/CodexData/local-secrets/VideoSreeeen/`，仅当前 Windows 用户及 SYSTEM 可访问。密码文件由当前用户的 Windows DPAPI 保护，**复制 DPAPI 文件到其他机器不能作为可解密的密码备份**；迁移前须在当前用户下解密并保存到自己的密码管理器，再安全备份 keystore。任何签名文件或密码均不得提交到仓库。

正式发布统一使用上述本地入口。创建版本标签或 Release 不再触发云端客户端构建，避免本地发布成功后又重复构建、重复发布或发送额外的构建失败通知。普通主分支 / PR 的 Verify 检查仍保留。

如需云端构建，可在 Actions 手动运行 `Build client artifacts (manual)`；它只生成可下载的构建产物，没有 Release 写入权限，也不发布版本。Android 仍需提前配置 `ANDROID_KEYSTORE_BASE64` / `ANDROID_STORE_PASSWORD` 两个仓库 Secret，必须使用同一正式签名；不自动上传本机签名文件。账号禁用 Actions 时不影响本地发布和用户获取更新。

2026-10-28 的 v0.4.6 标签曾触发一轮多余构建，Android 在 SDK 准备步骤报 `Failed to find package 'tools'`，Windows 成功而云端 publish 跳过。已显式改为安装 platform-tools、Android 35 平台及 35.0.0 build-tools，并移除标签触发和云端 publish 任务。这次云端失败没有修改已发布的本地产物；没有重跑失败任务或重新发布 v0.4.6。具体日志见 [失败任务](https://github.com/BorderArea01/VideoSreeeen/actions/runs/40649183476)。SDK 配置已静态核对，修正后的云端 Android 构建尚未实际运行。

Windows 目前未配置 Authenticode 签名证书；HTTPS Release 元数据与 SHA-512 校验不等于发布者代码签名。有正式证书后接入 Builder 签名配置与自动更新的发布者核验。

参考：[Electron Builder 自动更新](https://www.electron.build/v26/docs/features/auto-update/)、[Android 应用签名](https://developer.android.com/studio/publish/app-signing)、[Android PackageInstaller](https://developer.android.com/reference/android/content/pm/PackageInstaller)。
