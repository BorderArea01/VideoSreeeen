# GitHub 公开访问验收阻碍

2026-10-18 实测：仓库的 `private=false`、`visibility=public`，当前维护账号有管理权限，能读取源码并维护 Release；但不带任何登录凭证时，以下 API 全部返回 404：

- `https://api.github.com/users/BorderArea01`
- `https://api.github.com/repos/BorderArea01/VideoSreeeen`
- `https://api.github.com/repos/BorderArea01/VideoSreeeen/releases/latest`

Windows 成品使用公开 GitHub 更新源时，`releases.atom` 也返回 404，因此本轮不能标记“公共下载和在线更新已通过”。本机直连 github.com 另有连接超时，故同时使用了独立的匿名 API 校验。

## 代理、授权与公开可见性复核

2026-10-18 13:46（北京时间）完成同一客户端、同一 Clash HTTP 入口 `127.0.0.1:7897` 的对照检查。代理仅用于本轮请求，没有修改系统代理或 Clash 路由。

| 请求                                      | 匿名   | 当前维护账号授权                    |
| ----------------------------------------- | ------ | ----------------------------------- |
| 当前登录身份 `/user`                      | 不适用 | 200，`BorderArea01`，ID `149620762` |
| 公开用户 `/users/BorderArea01`            | 404    | 404                                 |
| 按 ID 查询用户 `/user/149620762`          | 404    | 404                                 |
| 仓库 `/repos/BorderArea01/VideoSreeeen`   | 404    | 200，公开且 `disabled=false`        |
| 按 ID 查询仓库 `/repositories/1423533430` | 404    | 200，同一仓库                       |
| 最新 Release                              | 404    | 200，`v0.4.0`，`draft=false`        |

补充对照：匿名查询 `/user/1` 返回 200；VideoTogether 仓库的 API 和网页均返回 200；匿名搜索 `BorderArea01 in:login` 返回 200，但结果数为 0。当前项目的原始 README、仓库网页、Release 网页均返回 404。仓库 Actions 设置读取为 `enabled=true`，历史运行数为 0；本轮未再次触发云端构建。

同一 Clash 入口的 `api.github.com` 和 `github.com` TLS 证书均校验通过，签发组织为 Sectigo Limited，域名分别匹配 `*.github.com` 和 `github.com`。响应包含 GitHub 请求编号；API 额度仍有剩余。本轮没有收到验证码页面、401、403 或 `X-GitHub-OTP` 挑战。此前 Node 直连检查没有自动使用系统代理，是验证覆盖的遗漏；本轮已显式经过 Clash 后复现上述访问差异。

当前令牌没有 `read:user` / `user` scope，`two_factor_authentication` 字段未返回，不能据此判断账号是否开启二次验证；参见 [用户 API 字段说明](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)。已成功读取身份、仓库和 Release，说明本次维护请求的令牌授权有效。公开访问异常仍需独立处理。[公开仓库应对互联网用户开放](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories)。

供 GitHub 支持关联服务端日志的请求编号（均为本轮 UTC `2026-10-18 05:46`）：

- 授权身份 200：`0554:259168:10CEFBE:19C8695:6AD45D21`。
- 授权公开用户查询 404：`0560:1BE762:1059064:195483D:6AD45D21`。
- 匿名仓库 404：`056A:21AB40:1030329:192B7D0:6AD45D21`。
- 同一仓库授权查询 200：`0560:1BE762:1059215:1954A9B:6AD45D21`。
- 匿名最新 Release 404：`056A:21AB40:10306A2:192BD8B:6AD45D22`。
- 最新 Release 授权查询 200：`0560:1BE762:10595E0:19550B5:6AD45D22`。

检查结果把问题缩小到 GitHub 对该账号的公开可见性处理；账号被标记是一种可能解释，平台内部可见性故障也尚未排除。现有接口没有返回具体限制原因，不能将推断写成 GitHub 已确认的封禁结论。详细的脱敏本机证据为 `.local/github-diagnostic-evidence.json`，不包含令牌、Cookie 或完整页面。

维护账号可见 `v0.4.0` 已结束草稿状态，7 个文件的 GitHub 服务端 SHA-256 与本地完整一致；发布目标源码为 `47f4ef56dfc8a77032c943038b766c8d0be96d4c`。应用运行时代码为 `1948f376fd388c3fa1ff9e851fbb0f794c68a36b`，后续仅修改测试、发布脚本和文档。

这提示可能存在 GitHub 账号可见性限制，但接口不能确认具体原因。仓库已经公开，不通过反复切换公开 / 私有处理；也不把维护者令牌放进客户端供其他人使用。Cloudflare 网页和房间服务不受此 GitHub 可见性阻碍影响。

用户已反馈登录后未看到异常提示。这不提供公开访问正常的证据，也不能据此确认存在账号标记。下一步通过 [GitHub 支持](https://support.github.com/contact) 请求检查账号公开可见性，并附上下列事实与请求编号。若支持确认存在限制，再按 [申诉与恢复流程](https://docs.github.com/en/site-policy/acceptable-use-policies/github-appeal-and-reinstatement) 处理；本轮未代为发送工单。

可复制给支持团队的事实说明（未代为发送）：

```text
Subject: Public account and repository return 404 to anonymous visitors

My GitHub username is BorderArea01.
I can sign in and access my repository BorderArea01/VideoSreeeen.
Its repository settings and authenticated REST API report public visibility.
However, anonymous requests to my user profile, the public repository,
and its latest release all return HTTP 404.
I do not see an account warning when signed in.
GitHub Actions also previously reported that Actions was disabled for my user.

On October 18, 2026 at approximately 05:46 UTC, we repeated these requests
through the same Clash HTTP proxy with verified GitHub TLS certificates:
- Authenticated GET /user: 200, login BorderArea01, user ID 149620762.
- GET /users/BorderArea01: 404, both anonymously and with my own token.
- Repository GET: 404 anonymously, 200 with my own token; private=false,
  visibility=public, disabled=false. The repository ID is 1423533430.
- Latest release GET: 404 anonymously, 200 with my own token; draft=false.
- Anonymous search for my login: 200, total_count=0.
- The VideoTogether/VideoTogether public repository returned 200 as a control.

Example request IDs:
Anonymous repository 404: 056A:21AB40:1030329:192B7D0:6AD45D21
Authenticated repository 200: 0560:1BE762:1059215:1954A9B:6AD45D21
Authenticated public user lookup 404: 0560:1BE762:1059064:195483D:6AD45D21

The repository contains a GPL-3.0 open-source watch-party application,
with Windows and Android clients. I have prepared release v0.4.0,
but other users cannot access its release downloads or update metadata.

Could you review whether there is an account visibility restriction
and tell me what steps are required to restore public access?
```

恢复后复验匿名仓库 / Release 为 200、两端下载及摘要一致，再用实际 Windows 成品检查 GitHub 在线更新。账号未恢复前，本机安装包可供当前维护者验收，不能将公共分发称为可用。
