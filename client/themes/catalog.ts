import { ThemeRegistry } from './core/registry';
import type { ThemeDefinition } from './core/types';
import classic from './classic/manifest';

// Each bundled theme owns its manifest and lazy entry; no central switch branches.
const definitions = import.meta.glob<ThemeDefinition>('./*/manifest.ts', {
  eager: true,
  import: 'default',
});
export const themeRegistry = new ThemeRegistry([classic], classic.id);
for (const [path, definition] of Object.entries(definitions)) {
  if (path === './classic/manifest.ts') continue;
  try {
    themeRegistry.register(definition);
  } catch {
    console.warn(`[themes] Invalid optional manifest: ${path}`);
  }
}
