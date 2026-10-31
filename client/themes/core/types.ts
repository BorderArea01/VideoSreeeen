import type { ThemeScope } from './scope';

/** Bundled, trusted application code. A theme never owns media or room state. */
export interface ThemeModule {
  styles: readonly string[];
  mount(scope: ThemeScope): void;
}
export interface ThemeDefinition {
  id: string;
  name: string;
  hint?: string;
  order: number;
  themeColor: string;
  preview: { background: string; panel: string; accent: string; border: string };
  load(): Promise<ThemeModule>;
}
