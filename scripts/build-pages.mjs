import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const target = resolve('.local/pages-dist');
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
