# 客户端分发与更新

发布入口为本仓库的 GitHub Releases。网页设置中的“版本与更新”提供 Windows 安装版和 Android APK；不要求使用者下载源码或查找 Actions 构建产物。

Windows 安装版使用 Electron Builder NSIS 与 electron-updater，生成 `latest.yml`、安装包及差分 blockmap。应用自动检查版本，下载和安装由使用者点击；安装时退出应用，保留用户设置。不在退出时悄悄安装。便携版继续提供，首次需安装安装版才能使用其后续应用内更新。

Android 从固定仓库的 `update.json` 获取版本号、单调增加的 versionCode、文件大小及 SHA-256；下载到应用自己的更新目录，核对包名、版本及当前应用签名后才交给系统安装器。只允许 GitHub 及其 HTTPS 资产域名重定向，包大小上限 128 MiB，临时文件失败后清理。Android 首次需要允许“此应用安装未知应用”，每次安装仍需要系统确认；不需要先卸载旧版。

首个正式签名 APK 与之前的 debug APK 签名不同，不能直接覆盖。不能为了换签名自动卸载已有应用或清除其数据。后续所有正式版必须沿用同一签名，版本码递增。

## 维护者发布

1. 修改 package.json / package-lock.json 的版本、Android versionName / versionCode、服务健康版本与发布说明；完成测试和产物检查。
2. 本机按受控入口构建 Windows 和 Android 发布包。APK 使用 `scripts/build-android.ps1 -Release`，不安装到任何设备。
3. 提交并推送对应源码，然后运行 `npm run release:prepare`，在 `artifacts/release/<版本>/` 生成两端包、Windows 更新元数据、Android 更新清单与校验和。
4. `npm run release:publish` 核对主分支提交和清洁工作树，先创建草稿并上传完整文件，确认资产数量后才公开。已存在的版本不覆盖；失败留在草稿，修复后人工核查重试。

Android 发布需要 `VS_ANDROID_KEYSTORE`、`VS_ANDROID_STORE_PASSWORD`，别名 `videosreeeen`。本机的固定签名保存在工作区之外的 `D:/CodexData/local-secrets/VideoSreeeen/`，仅当前 Windows 用户及 SYSTEM 可访问。密码文件由当前用户的 Windows DPAPI 保护，**复制 DPAPI 文件到其他机器不能作为可解密的密码备份**；迁移前须在当前用户下解密并保存到自己的密码管理器，再安全备份 keystore。任何签名文件或密码均不得提交到仓库。

标签工作流支持自动构建并创建 Release，手动触发只生成构建产物。需要仓库 Actions 可用，并配置 `ANDROID_KEYSTORE_BASE64` / `ANDROID_STORE_PASSWORD` 两个仓库 Secret，必须使用同一正式签名。账号禁用 Actions 时使用上述本地发布入口，不依赖 Actions 才能让用户获取更新。

Windows 目前未配置 Authenticode 签名证书；HTTPS Release 元数据与 SHA-512 校验不等于发布者代码签名。有正式证书后接入 Builder 签名配置与自动更新的发布者核验。

参考：[Electron Builder 自动更新](https://www.electron.build/v26/docs/features/auto-update/)、[Android 应用签名](https://developer.android.com/studio/publish/app-signing)、[Android PackageInstaller](https://developer.android.com/reference/android/content/pm/PackageInstaller)。
