import type { MediaInput } from '../shared/protocol';
import qrcode from 'qrcode-generator';
import { bilibiliLoginQr } from '../shared/bilibili-login';

type Credentials = { server: string; code: string; member: string; secret: string };
export class BrowserBilibiliLoginRequired extends Error {
  constructor() {
    super('请确认本次取源登录；观众无需登录。验证服务仅短时使用会话。');
  }
}
export class BrowserBilibiliLogin {
  private dialog = document.createElement('dialog');
  private controller: AbortController | null = null;
  private credentials: Credentials | null = null;
  private accepted = false;
  private attempt: string | null = null;
  private authorized: { c: Credentials; id: string } | null = null;
  private timer = 0;
  constructor(
    private current: () => Credentials | null,
    private completed: () => void,
  ) {
    this.dialog.id = 'bili-web-login';
    this.dialog.setAttribute('aria-labelledby', 'bili-web-title');
    this.dialog.innerHTML = `<h2 id="bili-web-title">B 站取源验证</h2><p class="dialog-note">用 B 站 App 扫描官方登录二维码并确认。本次会话仅在取源服务内存中使用，最长 15 分钟，离开房间或退出后删除；不交给观众。</p><p id="bili-web-service" class="dialog-note"></p><div id="bili-web-qr"></div><p id="bili-web-status" class="dialog-note" role="status"></p><div class="dialog-buttons"><button id="bili-web-cancel" class="button soft" type="button">取消</button><button id="bili-web-start" class="button accent" type="button">同意并生成二维码</button></div>`;
    document.body.append(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>('#bili-web-cancel')!.onclick = () => this.cancel();
    this.dialog.querySelector<HTMLButtonElement>('#bili-web-start')!.onclick = () => {
      void this.start();
    };
    this.dialog.oncancel = () => this.cancel();
  }
  private status(text: string) {
    this.dialog.querySelector('#bili-web-status')!.textContent = text;
  }
  private async call(c: Credentials, action: string, signal?: AbortSignal, body?: unknown) {
    const r = await fetch(`${c.server}/bili-web/${c.code}/${action}`, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: {
        Authorization: 'Bearer ' + c.secret,
        'X-Member-Id': c.member,
        'Content-Type': 'application/json',
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await r.json();
    if (!r.ok) {
      if (result.needsLogin) throw new BrowserBilibiliLoginRequired();
      throw new Error(result.error || '本次取源验证暂不可用');
    }
    return result;
  }
  async resolve(media: MediaInput, signal: AbortSignal): Promise<MediaInput> {
    const c = this.current();
    if (!c) throw new Error('请先加入房间');
    const { media: result } = await this.call(c, 'resolve', signal, { url: media.url });
    if (
      !result?.source?.bilibiliDirect ||
      result.provider !== 'bilibili' ||
      result.url !== media.url
    )
      throw new Error('验证服务未返回当前视频的高清源');
    return result;
  }
  open() {
    this.cancel();
    this.accepted = false;
    this.credentials = this.current();
    if (!this.credentials) return;
    const server = new URL(this.credentials.server);
    this.dialog.querySelector('#bili-web-service')!.textContent = '取源服务：' + server.origin;
    this.status('点击同意后才会向 B 站申请本次登录。');
    this.dialog.querySelector<HTMLButtonElement>('#bili-web-start')!.disabled = false;
    this.dialog.showModal();
    if (
      server.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(server.hostname)
    ) {
      this.status('本次登录仅支持 HTTPS 服务或本机回环地址。');
      this.dialog.querySelector<HTMLButtonElement>('#bili-web-start')!.disabled = true;
    }
  }
  private async start() {
    const c = this.credentials;
    if (!c) return;
    clearTimeout(this.timer);
    this.controller?.abort();
    const id = crypto.randomUUID();
    this.attempt = id;
    const controller = new AbortController();
    this.controller = controller;
    const start = this.dialog.querySelector<HTMLButtonElement>('#bili-web-start')!;
    start.disabled = true;
    this.status('正在申请官方二维码…');
    const valid = () =>
      this.controller === controller &&
      !controller.signal.aborted &&
      this.dialog.open &&
      JSON.stringify(this.current()) === JSON.stringify(c);
    try {
      const result = await this.call(c, 'start', controller.signal, { id });
      if (!valid()) return;
      const url = bilibiliLoginQr(result.qrUrl);
      if (!url) throw new Error('官方二维码格式无效');
      const qr = qrcode(0, 'M');
      qr.addData(url.href);
      qr.make();
      this.dialog.querySelector('#bili-web-qr')!.innerHTML = qr.createSvgTag({
        scalable: true,
        margin: 4,
      });
      this.status('请用 B 站 App 扫码并确认这次登录。');
      const poll = async () => {
        if (!valid()) return;
        try {
          const state = await this.call(c, 'poll', controller.signal, { id });
          if (!valid()) return;
          if (state.state === 'authorized') {
            this.accepted = true;
            this.authorized = { c, id };
            this.attempt = null;
            this.controller = null;
            this.dialog.querySelector('#bili-web-qr')!.replaceChildren();
            this.dialog.close();
            this.credentials = null;
            this.completed();
            return;
          }
          this.status(
            state.state === 'confirm' ? '已扫码，请在 B 站 App 确认。' : '等待 B 站扫码确认…',
          );
          this.timer = window.setTimeout(poll, 3000);
        } catch (e) {
          if (valid()) {
            this.status(e instanceof Error ? e.message : '本次登录验证失败');
            start.disabled = false;
            this.dialog.querySelector('#bili-web-qr')!.replaceChildren();
          }
        }
      };
      this.timer = window.setTimeout(poll, 3000);
    } catch (e) {
      if (valid()) {
        this.status(e instanceof Error ? e.message : '本次登录验证失败');
        start.disabled = false;
      }
    }
  }
  cancel() {
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = null;
    if (this.credentials && !this.accepted && this.attempt)
      void this.call(this.credentials, 'stop', undefined, { id: this.attempt }).catch(() => {});
    this.attempt = null;
    this.credentials = null;
    this.dialog.querySelector('#bili-web-qr')!.replaceChildren();
    if (this.dialog.open) this.dialog.close();
  }
  forget(all = true) {
    const c = this.current();
    this.cancel();
    const auth = this.authorized;
    this.authorized = null;
    if (all && c) void this.call(c, 'logout').catch(() => {});
    else if (auth) void this.call(auth.c, 'stop', undefined, { id: auth.id }).catch(() => {});
  }
}
