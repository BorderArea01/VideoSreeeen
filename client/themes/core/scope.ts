/** Every resource acquired by a theme has one lifetime and an idempotent release. */
export class ThemeScope {
  private abort = new AbortController();
  private cleanups: (() => void)[] = [];
  private nodes = new Set<Element>();
  private observers = new Set<{ disconnect(): void }>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private frames = new Set<number>();
  private listeners = 0;
  private attributes = new Map<
    Element,
    Map<string, { before: string | null; last: string | null }>
  >();
  private closed = false;
  constructor(readonly id: string) {}
  get disposed() {
    return this.closed;
  }
  get signal() {
    return this.abort.signal;
  }
  snapshot() {
    return {
      disposed: this.closed,
      nodes: this.nodes.size,
      observers: this.observers.size,
      timers: this.timers.size,
      frames: this.frames.size,
      listeners: this.listeners,
    };
  }
  defer(cleanup: () => void) {
    if (this.closed) cleanup();
    else this.cleanups.push(cleanup);
  }
  guard<T extends unknown[]>(callback: (...args: T) => void) {
    return (...args: T) => {
      if (!this.closed) callback(...args);
    };
  }
  listen<K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget,
    type: K,
    callback: (event: GlobalEventHandlersEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    callback: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    callback: any,
    options: AddEventListenerOptions | boolean = {},
  ) {
    if (this.closed) return;
    const guarded: EventListener = (event) => {
      if (!this.closed) {
        if (typeof callback === 'function') callback(event);
        else callback.handleEvent(event);
      }
    };
    target.addEventListener(type, guarded, {
      ...(typeof options === 'boolean' ? { capture: options } : options),
      signal: this.signal,
    });
    this.listeners++;
  }
  observe<T extends { disconnect(): void }>(observer: T): T {
    if (this.closed) observer.disconnect();
    else this.observers.add(observer);
    return observer;
  }
  own<T extends Element>(node: T): T {
    if (this.closed) node.remove();
    else this.nodes.add(node);
    return node;
  }
  style(css: string) {
    if (this.closed) return;
    const node = this.own(document.createElement('style'));
    node.dataset.themeStyle = this.id;
    node.textContent = css;
    document.head.append(node);
  }
  timeout(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.closed) callback();
    }, delay);
    if (this.closed) clearTimeout(timer);
    else this.timers.add(timer);
    return timer;
  }
  clearTimeout(timer: ReturnType<typeof setTimeout>) {
    clearTimeout(timer);
    this.timers.delete(timer);
  }
  frame(callback: FrameRequestCallback) {
    if (this.closed) return 0;
    const frame = requestAnimationFrame((time) => {
      this.frames.delete(frame);
      if (!this.closed) callback(time);
    });
    this.frames.add(frame);
    return frame;
  }
  cancelFrame(frame: number) {
    cancelAnimationFrame(frame);
    this.frames.delete(frame);
  }
  attribute(node: Element, name: string, value: string | null) {
    if (this.closed) return;
    let names = this.attributes.get(node);
    if (!names) {
      names = new Map();
      this.attributes.set(node, names);
    }
    const saved = names.get(name);
    names.set(name, { before: saved ? saved.before : node.getAttribute(name), last: value });
    if (value === null) node.removeAttribute(name);
    else node.setAttribute(name, value);
  }
  dispose() {
    if (this.closed) return [];
    this.closed = true;
    const errors: unknown[] = [];
    const release = (cleanup: () => void) => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    };
    this.abort.abort();
    this.listeners = 0;
    for (const observer of this.observers) release(() => observer.disconnect());
    this.observers.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const frame of this.frames) cancelAnimationFrame(frame);
    this.frames.clear();
    for (const cleanup of this.cleanups.reverse())
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    this.cleanups = [];
    for (const [node, names] of this.attributes)
      for (const [name, saved] of names) {
        release(() => {
          if (node.getAttribute(name) !== saved.last) return;
          if (saved.before === null) node.removeAttribute(name);
          else node.setAttribute(name, saved.before);
        });
      }
    this.attributes.clear();
    for (const node of this.nodes) release(() => node.remove());
    this.nodes.clear();
    return errors;
  }
}
