import { ThemeRegistry } from './registry';
import { ThemeScope } from './scope';
import type { ThemeDefinition, ThemeModule } from './types';

export interface ThemeHost {
  apply(definition: ThemeDefinition): void;
  scope(id: string): ThemeScope;
}
const browserHost: ThemeHost = {
  apply(definition) {
    document.documentElement.dataset.theme = definition.id;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', definition.themeColor);
  },
  scope: (id) => new ThemeScope(id),
};
export class ThemeController {
  private activeId: string;
  private requestedId: string;
  private scope?: ThemeScope;
  private sequence = 0;
  private closed = false;
  private loading = false;
  private failed = false;
  private loads = new WeakMap<ThemeDefinition, Promise<ThemeModule>>();
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  constructor(
    readonly registry: ThemeRegistry,
    private host: ThemeHost = browserHost,
  ) {
    this.activeId = this.requestedId = registry.defaultId;
    this.host.apply(registry.get(registry.defaultId)!);
    this.unsubscribe = registry.subscribe(() => {
      if (!registry.has(this.activeId) || !registry.has(this.requestedId))
        void this.select(registry.defaultId);
    });
  }
  snapshot() {
    return {
      active: this.activeId,
      requested: this.requestedId,
      loading: this.loading,
      failed: this.failed,
      disposed: this.closed,
      resources: this.scope?.snapshot() ?? null,
    };
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify() {
    for (const listener of [...this.listeners]) listener();
  }
  private load(definition: ThemeDefinition) {
    let promise = this.loads.get(definition);
    if (!promise) {
      promise = Promise.resolve()
        .then(() => definition.load())
        .catch((error) => {
          this.loads.delete(definition);
          throw error;
        });
      this.loads.set(definition, promise);
    }
    return promise;
  }
  async select(id: string) {
    const definition = this.registry.get(id);
    if (this.closed || !definition) return false;
    if (id === this.activeId) {
      ++this.sequence;
      this.requestedId = id;
      this.loading = false;
      this.failed = false;
      this.notify();
      return true;
    }
    const sequence = ++this.sequence;
    this.requestedId = id;
    this.loading = true;
    this.failed = false;
    this.notify();
    let module: ThemeModule;
    try {
      module =
        id === this.registry.defaultId ? { styles: [], mount() {} } : await this.load(definition);
    } catch {
      if (sequence === this.sequence && !this.closed) {
        this.requestedId = this.activeId;
        this.loading = false;
        this.failed = true;
        this.notify();
      }
      return false;
    }
    if (this.closed || sequence !== this.sequence || this.registry.get(id) !== definition)
      return false;
    const cleanupErrors = this.scope?.dispose();
    this.scope = undefined;
    const scope = this.host.scope(id);
    try {
      if (cleanupErrors?.length) throw new Error('Previous theme cleanup failed');
      this.host.apply(definition);
      if (module.styles.length) scope.style(module.styles.join('\n'));
      module.mount(scope);
      this.scope = scope;
      this.activeId = id;
    } catch {
      scope.dispose();
      this.activeId = this.registry.defaultId;
      this.host.apply(this.registry.get(this.registry.defaultId)!);
      this.failed = true;
    }
    this.requestedId = this.activeId;
    this.loading = false;
    this.notify();
    return !this.failed;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    ++this.sequence;
    this.unsubscribe();
    this.scope?.dispose();
    this.scope = undefined;
    this.activeId = this.requestedId = this.registry.defaultId;
    this.host.apply(this.registry.get(this.registry.defaultId)!);
    this.loading = false;
    this.listeners.clear();
  }
}
