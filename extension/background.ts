import {
  allowedAccountBilibiliMetadata,
  resolveAccountBilibiliPage,
  nextBilibiliPage,
} from '../shared/bilibili';
import { readBilibiliMetadata } from './metadata';
declare const chrome: any;
const tasks = new Map<number, { id: string; controller: AbortController }>();
function allowedSender(sender: any) {
  if (sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !sender.url) return false;
  try {
    const u = new URL(sender.url);
    return (
      !u.username &&
      !u.password &&
      (u.origin === 'https://videosreeeen.pages.dev' ||
        (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
chrome.runtime.onMessage.addListener(
  (message: any, sender: any, reply: (result: unknown) => void) => {
    if (
      !allowedSender(sender) ||
      !message ||
      !/^[a-f0-9-]{36}$/i.test(message.id ?? '') ||
      !['ping', 'resolve', 'next', 'cancel'].includes(message.action)
    ) {
      reply({ error: '不允许的扩展请求', code: 'DENIED' });
      return false;
    }
    const tab = sender.tab.id;
    if (message.action === 'ping') {
      reply({ version: chrome.runtime.getManifest().version });
      return false;
    }
    if (message.action === 'cancel') {
      const task = tasks.get(tab);
      if (task && task.id === message.id) task.controller.abort();
      reply({ cancelled: true });
      return false;
    }
    tasks.get(tab)?.controller.abort();
    const pending = { id: message.id, controller: new AbortController() };
    tasks.set(tab, pending);
    const signal = AbortSignal.any([pending.controller.signal, AbortSignal.timeout(12000)]);
    void (async () => {
      try {
        const read = async (url: string) => {
          if (!allowedAccountBilibiliMetadata(url)) throw new Error('B 站接口不在取源范围内');
          const response = await fetch(url, {
            credentials: 'include',
            redirect: 'error',
            cache: 'no-store',
            signal,
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`B 站接口暂不可用（HTTP ${response.status}）`);
          }
          return readBilibiliMetadata(response, url, signal);
        };
        if (typeof message.url !== 'string' || message.url.length > 2048)
          throw new Error('B 站链接无效');
        const result =
          message.action === 'next'
            ? { next: await nextBilibiliPage(message.url, read) }
            : { media: await resolveAccountBilibiliPage(message.url, read) };
        signal.throwIfAborted();
        if (tasks.get(tab) !== pending) throw new Error('已取消取源');
        reply(result);
      } catch (error: any) {
        reply({
          code:
            error?.code === 'BILIBILI_LOGIN_REQUIRED'
              ? 'LOGIN_REQUIRED'
              : signal.aborted
                ? 'CANCELLED'
                : 'SOURCE_FAILED',
          error: signal.aborted
            ? '已取消取源或请求超时'
            : error?.message?.startsWith('B 站')
              ? error.message
              : 'B 站视频源暂不可用，请在原站确认可播放后重试',
        });
      } finally {
        if (tasks.get(tab) === pending) tasks.delete(tab);
      }
    })();
    return true;
  },
);
chrome.tabs.onRemoved.addListener((tab: number) => {
  tasks.get(tab)?.controller.abort();
  tasks.delete(tab);
});
chrome.tabs.onUpdated.addListener((tab: number, change: { status?: string }) => {
  if (change.status === 'loading') {
    tasks.get(tab)?.controller.abort();
    tasks.delete(tab);
  }
});
