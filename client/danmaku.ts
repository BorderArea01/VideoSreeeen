import type { Chat } from '../shared/protocol';

declare global {
  interface Window {
    __VS_Danmaku: {
      push(messages: Array<{ text: string }>, target?: HTMLElement): void;
      clear(): void;
      enable(value: boolean): void;
    };
  }
}
export class DanmakuFeed {
  private scope = '';
  private seen = new Set<string>();
  reset() {
    this.scope = '';
    this.seen.clear();
  }
  take(scope: string, chat: Chat[]) {
    if (scope !== this.scope) {
      this.scope = scope;
      this.seen = new Set(chat.map((c) => c.id));
      return [];
    }
    const fresh = chat.filter((c) => !this.seen.has(c.id));
    for (const c of chat) this.seen.add(c.id);
    while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    return fresh.flatMap((c) => (c.text ? [{ text: c.text }] : []));
  }
}
