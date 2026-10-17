# GitHub 公开访问验收阻碍

2026-10-18 实测：仓库的 `private=false`、`visibility=public`，当前维护账号有管理权限，能读取源码并维护 Release；但不带任何登录凭证时，以下 API 全部返回 404：

- `https://api.github.com/users/BorderArea01`
- `https://api.github.com/repos/BorderArea01/VideoSreeeen`
- `https://api.github.com/repos/BorderArea01/VideoSreeeen/releases/latest`

Windows 成品使用公开 GitHub 更新源时，`releases.atom` 也返回 404，因此本轮不能标记“公共下载和在线更新已通过”。本机直连 github.com 另有连接超时，故同时使用了独立的匿名 API 校验。

维护账号可见 `v0.4.0` 已结束草稿状态，7 个文件的 GitHub 服务端 SHA-256 与本地完整一致；发布目标源码为 `47f4ef56dfc8a77032c943038b766c8d0be96d4c`。应用运行时代码为 `1948f376fd388c3fa1ff9e851fbb0f794c68a36b`，后续仅修改测试、发布脚本和文档。

这提示可能存在 GitHub 账号可见性限制，但接口不能确认具体原因。仓库已经公开，不通过反复切换公开 / 私有处理；也不把维护者令牌放进客户端供其他人使用。Cloudflare 网页和房间服务不受此 GitHub 可见性阻碍影响。

需要账号本人登录 GitHub 查看通知、账号提示和验证状态；若无法恢复公开访问，通过 [GitHub 支持](https://support.github.com/contact) 请求检查账号公开可见性。官方说明见 [申诉与恢复流程](https://docs.github.com/en/site-policy/acceptable-use-policies/github-appeal-and-reinstatement)；[Actions 账号禁用状态](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository) 也可能需要 GitHub 支持审核，普通仓库设置不能解除这种状态。

可复制给支持团队的事实说明（未代为发送）：

```text
Subject: Public account and repository return 404 to anonymous visitors

My GitHub username is BorderArea01.
I can sign in and access my repository BorderArea01/VideoSreeeen.
Its repository settings and authenticated REST API report public visibility.
However, anonymous requests to my user profile, the public repository,
and its latest release all return HTTP 404.
GitHub Actions also previously reported that Actions was disabled for my user.

The repository contains a GPL-3.0 open-source watch-party application,
with Windows and Android clients. I have prepared release v0.4.0,
but other users cannot access its release downloads or update metadata.

Could you review whether there is an account visibility restriction
and tell me what steps are required to restore public access?
```

恢复后复验匿名仓库 / Release 为 200、两端下载及摘要一致，再用实际 Windows 成品检查 GitHub 在线更新。账号未恢复前，本机安装包可供当前维护者验收，不能将公共分发称为可用。
