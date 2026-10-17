import type { CachePlan } from '../server/media';
export interface Sample {
  available: boolean;
  title?: string;
  position?: number;
  duration?: number;
  paused?: boolean;
  rate?: number;
  source?: import('../shared/protocol').Source;
  action?: 'play' | 'pause' | 'seek' | 'rate' | 'ended';
  seq?: number;
  frame?: string;
}
export interface NativeCache {
  state: 'downloading' | 'ready' | 'error';
  progress: number;
  bytes: number;
  fingerprint?: string;
  error?: string;
  jobId: string;
  entry?: string;
  audio?: string;
  peerBytes?: number;
  sourceBytes?: number;
}
declare global {
  interface Window {
    desktop?: {
      call(method: string, payload?: unknown): Promise<any>;
      onEvent(callback: (event: { type: string; data: any }) => void): void;
    };
    VSNative?: { request(id: string, method: string, payload: string): void };
    __nativeResolve?: (id: string, value: string) => void;
    __nativeEvent?: (type: string, data: string) => void;
  }
}
export const isNative = !!window.desktop || !!window.VSNative;
export const platform = window.desktop
  ? 'Windows 客户端'
  : window.VSNative
    ? 'Android 客户端'
    : '浏览器';
const pending = new Map<
  string,
  {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const events = new Set<(type: string, data: any) => void>();
window.__nativeResolve = (id, raw) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  try {
    const v = JSON.parse(raw);
    if (v.error) p.reject(new Error(v.error));
    else p.resolve(v.value);
  } catch {
    p.reject(new Error('客户端返回格式错误'));
  }
};
window.__nativeEvent = (type, data) => {
  try {
    const value = JSON.parse(data);
    for (const handler of events) handler(type, value);
  } catch {}
};
window.desktop?.onEvent((e) => {
  for (const handler of events) handler(e.type, e.data);
});
export const onNative = (handler: (type: string, data: any) => void) => {
  events.add(handler);
  return () => events.delete(handler);
};
export async function nativeCall(method: string, payload?: unknown): Promise<any> {
  if (window.desktop) return window.desktop.call(method, payload);
  if (!window.VSNative) throw new Error('此功能需要 Windows 或 Android 客户端');
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error('客户端响应超时'));
      },
      method === 'cacheIO' && (payload as { action?: string })?.action === 'finish'
        ? 180000
        : 20000,
    );
    pending.set(id, { resolve, reject, timer });
    window.VSNative!.request(id, method, JSON.stringify(payload ?? {}));
  });
}
export async function cacheNative(jobId: string, plan: CachePlan, server: string) {
  return nativeCall('cacheStart', {
    jobId,
    plan: {
      ...plan,
      files: plan.files.map((f) => (f.url ? { ...f, url: new URL(f.url, server).href } : f)),
    },
  });
}
