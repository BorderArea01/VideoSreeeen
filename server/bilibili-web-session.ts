import type { Rooms } from './rooms';
import { allowedAccountBilibiliMetadata, resolveAccountBilibiliPage } from './bilibili-source';
import { bilibiliLoginQr } from '../shared/bilibili-login';

export type BiliSessionFetch = (url: string, init: RequestInit) => Promise<Response>;
const PASSPORT = 'https://passport.bilibili.com/x/passport-login/web/qrcode/';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
  Accept: 'application/json',
};
type Session = {
  id: string;
  code: string;
  member: string;
  seat: NonNullable<ReturnType<Rooms['memberAccess']>>['seat'];
  expires: number;
  started: number;
  polled: number;
  key?: string;
  cookie?: string;
  busy: boolean;
  controller: AbortController;
};
class SessionError extends Error {}
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
async function smallText(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal: AbortSignal,
) {
  if (!body) throw new SessionError('原站响应为空');
  const reader = body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new SessionError('响应超过大小限制');
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(output);
}

/** Explicit opt-in validation only. Account cookies stay in this private, short-lived map. */
export class BilibiliWebSessions {
  #sessions = new Map<string, Session>();
  constructor(
    private rooms: Rooms,
    private fetcher: BiliSessionFetch = fetch,
    private now = Date.now,
  ) {}
  private drop(identity: string) {
    const entry = this.#sessions.get(identity);
    if (entry) {
      entry.cookie = undefined;
      entry.key = undefined;
      entry.controller.abort();
    }
    this.#sessions.delete(identity);
  }
  sweep() {
    for (const [identity, s] of this.#sessions)
      if (
        s.expires <= this.now() ||
        !s.seat.online ||
        this.rooms.rooms.get(s.code)?.members.get(s.member) !== s.seat
      )
        this.drop(identity);
  }
  close() {
    for (const identity of this.#sessions.keys()) this.drop(identity);
  }
  private async read(s: Session, url: string, account: boolean, signal: AbortSignal) {
    if (account && (!allowedAccountBilibiliMetadata(url) || !s.cookie))
      throw new SessionError('取源会话不可用');
    if (!account && !url.startsWith(PASSPORT)) throw new SessionError('登录地址不在验证范围内');
    const response = await this.fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: { ...HEADERS, ...(account ? { Cookie: 'SESSDATA=' + s.cookie } : {}) },
      signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new SessionError(
        `B 站${account ? '取源' : '登录'}接口拒绝请求（HTTP ${response.status}）`,
      );
    }
    const text = await smallText(response.body, 512 * 1024, signal);
    const body = JSON.parse(text);
    if (account && Number.isSafeInteger(body.code) && ![0, -101].includes(body.code))
      throw new SessionError(`B 站取源返回拒绝代码 ${body.code}`);
    return { response, text, body };
  }
  async handle(request: Request) {
    const match = /^\/bili-web\/([A-HJ-NP-Z2-9]{6})\/(start|poll|resolve|stop|logout)$/.exec(
      new URL(request.url).pathname,
    );
    if (!match) return reply({ error: 'Not found' }, 404);
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    const origin = request.headers.get('Origin');
    try {
      if (
        !origin ||
        origin === 'null' ||
        !/^https?:$/.test(new URL(origin).protocol) ||
        (new URL(origin).protocol !== 'https:' &&
          !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) ||
        new URL(origin).host !== request.headers.get('Host')
      )
        return reply({ error: 'Origin not allowed' }, 403);
    } catch {
      return reply({ error: 'Origin not allowed' }, 403);
    }
    const code = match[1]!,
      action = match[2]!,
      member = request.headers.get('X-Member-Id') ?? '';
    const access = this.rooms.memberAccess(
      code,
      member,
      request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '',
    );
    if (!access) return reply({ error: '请先加入房间' }, 401);
    const identity = code + ':' + member;
    this.sweep();
    if (action === 'logout') {
      this.drop(identity);
      return reply({ state: 'cleared' });
    }
    let attempt: string | undefined;
    if (action !== 'resolve') {
      try {
        const body = JSON.parse(
          await smallText(
            request.body,
            4096,
            AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
          ),
        );
        if (
          typeof body.id !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.id)
        )
          return reply({ error: '登录请求无效' }, 400);
        attempt = body.id;
      } catch {
        return reply({ error: '登录请求无效' }, 400);
      }
    }
    if (action === 'stop') {
      if (this.#sessions.get(identity)?.id === attempt) this.drop(identity);
      return reply({ state: 'cleared' });
    }
    let s = this.#sessions.get(identity);
    if (action === 'poll' && s?.id !== attempt)
      return reply({ needsLogin: true, state: 'expired' }, 409);
    if (action !== 'start' && !s) return reply({ needsLogin: true, state: 'expired' }, 409);
    if (s?.busy || (action === 'start' && s && this.now() - s.started < 10000))
      return reply({ error: '请稍候再试' }, 429);
    if (action === 'start') {
      if (this.#sessions.size >= 32 && !s) return reply({ error: '验证会话已满，请稍后重试' }, 429);
      this.drop(identity);
      s = {
        id: attempt!,
        code,
        member,
        seat: access.seat,
        expires: this.now() + 120000,
        started: this.now(),
        polled: 0,
        busy: false,
        controller: new AbortController(),
      };
      this.#sessions.set(identity, s);
    }
    const entry = s!;
    const current = () =>
      this.#sessions.get(identity) === entry &&
      !request.signal.aborted &&
      !entry.controller.signal.aborted &&
      entry.expires > this.now() &&
      !!this.rooms.memberAccess(
        code,
        member,
        request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '',
      );
    const signal = AbortSignal.any([
      request.signal,
      entry.controller.signal,
      AbortSignal.timeout(12000),
    ]);
    entry.busy = true;
    try {
      if (action === 'start') {
        const { body } = await this.read(entry, PASSPORT + 'generate', false, signal);
        const url = bilibiliLoginQr(body.data?.url, body.data?.qrcode_key);
        if (body.code !== 0 || !/^[a-z0-9]{16,128}$/i.test(body.data?.qrcode_key ?? '') || !url)
          throw new SessionError('原站没有返回有效的官方登录二维码');
        if (!current()) return reply({ error: '本次登录已取消' }, 409);
        entry.key = body.data.qrcode_key;
        return reply({ state: 'waiting', qrUrl: url.href, expiresAt: entry.expires });
      }
      if (action === 'poll') {
        if (entry.cookie) return reply({ state: 'authorized', expiresAt: entry.expires });
        if (!entry.key) throw new SessionError('本次登录不可用，请重新开始');
        if (entry.polled && this.now() - entry.polled < 2000)
          return reply({ state: 'waiting', expiresAt: entry.expires });
        entry.polled = this.now();
        const { body, response } = await this.read(
          entry,
          PASSPORT + 'poll?qrcode_key=' + encodeURIComponent(entry.key),
          false,
          signal,
        );
        if (!current()) return reply({ error: '本次登录已取消' }, 409);
        if (body.code !== 0) throw new SessionError('原站未确认本次登录');
        if (body.data?.code === 86038) {
          this.drop(identity);
          return reply({ needsLogin: true, state: 'expired' }, 409);
        }
        if ([86101, 86090].includes(body.data?.code))
          return reply({
            state: body.data.code === 86090 ? 'confirm' : 'waiting',
            expiresAt: entry.expires,
          });
        if (body.data?.code !== 0) throw new SessionError('原站未确认本次登录');
        const cookie = response.headers.getSetCookie().find((value) => /^SESSDATA=/i.test(value));
        const value = cookie && /^SESSDATA=([^;\r\n]{1,4096})(?:;|$)/.exec(cookie)?.[1];
        if (
          !value ||
          !/[;]\s*Domain=\.?bilibili\.com(?:;|$)/i.test(cookie!) ||
          !/^[A-Za-z0-9%._~,+\/-]+$/.test(value)
        )
          throw new SessionError('原站没有返回可用于本次取源的会话');
        const maxAge = /;\s*Max-Age=(-?\d+)/i.exec(cookie!)?.[1];
        const expires = /;\s*Expires=([^;]+)/i.exec(cookie!)?.[1];
        const limit = Math.min(
          this.now() + 15 * 60 * 1000,
          maxAge === undefined ? Infinity : this.now() + Number(maxAge) * 1000,
          expires === undefined ? Infinity : Date.parse(expires),
        );
        if (!Number.isFinite(limit) || limit <= this.now() || !/;\s*Path=\/(?:;|$)/i.test(cookie!))
          throw new SessionError('原站会话已失效或作用域不适用于本次取源');
        entry.cookie = value;
        entry.key = undefined;
        entry.expires = limit;
        return reply({ state: 'authorized', expiresAt: entry.expires });
      }
      if (!entry.cookie) return reply({ needsLogin: true }, 409);
      const body = JSON.parse(await smallText(request.body, 4096, signal));
      if (typeof body.url !== 'string') throw new SessionError('请提供 B 站视频页面链接');
      let media;
      try {
        media = await resolveAccountBilibiliPage(
          body.url,
          async (url) => (await this.read(entry, url, true, signal)).text,
        );
      } catch (cause: any) {
        if (cause?.code === 'BILIBILI_LOGIN_REQUIRED') {
          this.drop(identity);
          return reply({ needsLogin: true, state: 'expired' }, 409);
        }
        if (cause instanceof SessionError) throw cause;
        throw new SessionError('当前账号未取得此视频的完整高清音视频，请在原站确认可播放后重试');
      }
      if (!current()) return reply({ error: '已离开房间或取消识别，结果未使用' }, 409);
      return reply({ media });
    } catch (cause) {
      if ((action === 'start' || action === 'poll') && this.#sessions.get(identity) === entry)
        this.drop(identity);
      return reply(
        {
          error:
            cause instanceof SessionError
              ? cause.message
              : signal.aborted
                ? '验证请求已取消或超时'
                : '原站响应无法用于本次验证，请重试',
        },
        400,
      );
    } finally {
      entry.busy = false;
    }
  }
}
