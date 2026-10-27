# B 站网页取源服务（可选）

网页端发起 B 站共同播放时，公共 Cloudflare 出口请求 B 站公开接口会返回 HTTP 412；浏览器直接请求 `api.bilibili.com` 又会被 B 站按来源拒绝（本机验证：`Origin: https://videosreeeen.pages.dev` 返回 403 HTML）。因此公共部署需要一台能访问 B 站公开接口的 **Node 取源服务**，由它完成元数据解析；视频仍从 B 站 CDN 直接加载，不经过取源服务。

## 架构

```text
网页/客户端
  └─ POST /resolve-source/<房间码>（在线成员 + resume）
       └─ Cloudflare Worker / Durable Object
            └─ BILIBILI_RESOLVER_URL（本服务，Bearer token）
                 └─ api.bilibili.com 公开 view / playurl（匿名，无 Cookie）
            ← { media: { source.video: 签名 MP4, bilibiliHtml5: true } }
  ← 房间状态广播；各端从 *.bilivideo.com 加载 MP4
```

- 取源服务只返回 B 站公开接口给出的 **游客 MP4 签名地址**，不代理视频字节、不接收 Cookie、不进入房间状态。
- Cloudflare 房间状态仍由 Durable Object 持有；取源服务是可选出口，不是第二个房间服务。
- 未配置取源服务时行为不变：公共部署继续返回 412，并提示 Windows 房主取源或改用共享画面。
- 取源服务也可以直接作为 Node 房间服务器使用；这种部署不需要本页的转发配置，`/resolve-source` 会直接解析。

## 部署 Node 取源服务

要求：Node 24+、可访问 `api.bilibili.com` 和 `*.bilivideo.com`、HTTPS 反向代理（Cloudflare Worker 只能请求 HTTPS；本地联调可短暂使用 http）。

### Docker

```bash
docker build -t videosreeeen .
docker run -d --restart unless-stopped \
  -e BILIBILI_RESOLVER_TOKEN='<随机长令牌>' \
  -p 127.0.0.1:8787:8787 \
  --memory 512m --cpus 1 \
  videosreeeen
```

前置 Nginx/Caddy 提供 HTTPS，例如 `https://resolver.example.com`。健康检查：`GET /healthz`。

### 直接运行

```bash
npm ci
npm run build
BILIBILI_RESOLVER_TOKEN='<随机长令牌>' npm start
```

### 配置 Cloudflare Worker

取源服务和 Worker 使用同一个令牌；不要把令牌写进前端、仓库或 `wrangler.jsonc`。

```bash
npx wrangler secret put BILIBILI_RESOLVER_URL      # 例如 https://resolver.example.com
npx wrangler secret put BILIBILI_RESOLVER_TOKEN    # 与 Node 服务一致
npx wrangler deploy
```

本地 `wrangler dev` 可用 `.dev.vars`（不要提交）：

```dotenv
BILIBILI_RESOLVER_URL="https://resolver.example.com"
BILIBILI_RESOLVER_TOKEN="<本地测试令牌>"
```

配置成功后，Worker `/config` 返回 `bilibiliResolver: true`；Web 端识别 B 站链接时由 Worker 调用取源服务，不再返回 412。旧的客户端不读取该字段，不受影响。

## 端点与安全边界

`POST /internal/bilibili-resolve`（Node）

- `Authorization: Bearer <BILIBILI_RESOLVER_TOKEN>`；未配置令牌时端点返回 404。
- 请求体：`{ "action": "resolve" | "next", "url": "https://www.bilibili.com/video/BV…/" }`，最大 4 KiB。
- 响应：`{ "media": MediaInput }` 或 `{ "next": Episode | null }`。
- 只接受 B 站 `/video/BV…` 公开页面；请求目标由服务端白名单拼接，不接受任意 URL。
- 不发送 Cookie、SDP、房间令牌；不记录签名 URL、原始响应或 Cookie。
- 12 秒超时；元数据响应上限 512 KiB；Worker 侧再校验同一 BV、`bilibiliHtml5`、`file`、单视频地址、`*.bilivideo.com` 与 `deadline`。
- 取源服务返回的 `media` 会再次经过 Worker 的 `media` 消息校验，不会因为服务端被篡改就把任意媒体写进房间。

## 不支持的授权模式

- 不支持“用户在网页完成 B 站登录，服务端只检测完成状态、不接触 Cookie”的模式。B 站没有向第三方网页提供可回调的播放授权，登录 Cookie 属于 `bilibili.com` 域；服务端无法验证，页面也无法把该会话用于 B 站播放接口。客户端自报“已登录”不是授权证明，不能用于放行内容或提升画质。
- 该取源服务只使用匿名游客接口；不导入、不上传、不转发任何 B 站 Cookie，也不保管用户账号会话。
- 逐人登录后观看高清/会员/付费内容需要浏览器扩展、本地伴侣或服务端会话代理，属于另一套安全与条款边界，不在本方案内。

## 能力与限制

- 仅公开视频的匿名游客 MP4（实测 640×360；不承诺 1080p）。登录/会员/付费/DRM 仍不由该路径支持。
- 需要各成员能访问 `*.bilivideo.com`；CDN 过期、地区限制、下架与解码差异仍可能导致个别成员失败。
- 取源服务只影响“解析”这一步；视频加载者仍是各端浏览器/客户端，符合“原站视频代理关闭”的公共部署边界。
- 这是额外运维的服务：需要一台长期在线、能访问 B 站的机器；免费额度、网络、HTTPS 证书由部署者承担。公共 Cloudflare 免费额度本身不包含该出口。
- 如果不部署取源服务，替代路径仍是 Windows 房主取源、共享画面或使用 Node 房间服务器。

## 验证

本地 Node 解析（真实公开视频，不保存签名地址）：

```bash
npm run test:bilibili-resolver
```

指定已部署取源服务：

```bash
VS_RESOLVER_URL=https://resolver.example.com \
VS_RESOLVER_TOKEN='<令牌>' \
npm run test:bilibili-resolver
```

已验证的自动化（本地 Node，无需 Cloudflare）：

- `tests/bilibili-resolver.test.ts`：解析服务返回媒体、跨 BV/越权地址拒绝、令牌、请求体、B 站请求头。
- `npm test`、`npm run check:worker`、`npm run worker:check`（需要先 `npm run build`）。

尚未完成：

- 真实 Cloudflare Worker + 真实公网取源服务的端到端实播（本轮无 Cloudflare 凭据与公网 Node 服务；不能把本地 Node 结果当作公网通过）。
- 取源服务在目标网络出口的 B 站 412/地区/风控表现，需要部署后按实际网络复验。
- 各成员 CDN 可达性、长视频签名过期与迟到加入，仍按现有验证边界另行复验。
