import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const target = resolve('.local/pages-dist');
const expected = fileURLToPath(new URL('../.local/pages-dist', import.meta.url));
if (target !== resolve(expected)) throw new Error('Pages output is outside this workspace');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve('dist'), target, { recursive: true });
await cp(resolve('pages/_worker.js'), resolve(target, '_worker.js'));
await writeFile(
  resolve(target, '_routes.json'),
  JSON.stringify({
    version: 1,
    include: [
      '/ws',
      '/broadcast-relay',
      '/voice',
      '/healthz',
      '/config',
      '/cache-plan/*',
      '/media/*',
      '/images/*',
      '/resolve-source/*',
    ],
    exclude: [],
  }),
);
