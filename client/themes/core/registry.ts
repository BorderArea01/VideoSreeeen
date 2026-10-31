import type { ThemeDefinition } from './types';

export class ThemeRegistry {
  private entries = new Map<string, ThemeDefinition>();
  private listeners = new Set<() => void>();
  constructor(
    definitions: readonly ThemeDefinition[],
    readonly defaultId: string,
  ) {
    for (const definition of definitions) this.register(definition);
    if (!this.entries.has(defaultId)) throw new Error('Default theme is required');
  }
  list() {
    return [...this.entries.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
  get(id: string) {
    return this.entries.get(id);
  }
  has(id: string | null): id is string {
    return id !== null && this.entries.has(id);
  }
  register(definition: ThemeDefinition) {
    if (
      !/^[a-z][a-z0-9-]{0,31}$/.test(definition.id) ||
      !definition.name.trim() ||
      !Number.isFinite(definition.order) ||
      !/^#[a-f0-9]{6}$/i.test(definition.themeColor) ||
      typeof definition.load !== 'function'
    )
      throw new Error('Invalid theme definition');
    if (this.entries.has(definition.id)) throw new Error('Theme is already registered');
    this.entries.set(
      definition.id,
      Object.freeze({ ...definition, preview: Object.freeze({ ...definition.preview }) }),
    );
    this.changed();
  }
  unregister(id: string) {
    if (id === this.defaultId) throw new Error('Default theme cannot be removed');
    const removed = this.entries.delete(id);
    if (removed) this.changed();
    return removed;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed() {
    for (const listener of [...this.listeners]) listener();
  }
}
