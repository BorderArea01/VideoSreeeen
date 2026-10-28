import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const target = 'artifacts/browser-extension';
await mkdir(target, { recursive: true });
await build({
  entryPoints: ['extension/background.ts'],
  outfile: target + '/background.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
});
await build({
  entryPoints: ['extension/bridge.ts'],
  outfile: target + '/bridge.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
});
for (const name of ['manifest.json', 'popup.html', 'popup.css'])
  await copyFile('extension/' + name, target + '/' + name);
await copyFile('LICENSE', target + '/LICENSE');
console.log('Browser extension built: ' + target);
