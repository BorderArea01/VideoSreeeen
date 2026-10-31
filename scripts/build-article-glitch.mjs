import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'docs/design/article-glitch');
const target = path.join(root, '.local/article-glitch-dist');
if (path.dirname(target) !== path.join(root, '.local')) throw new Error('Unexpected build target');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of [
  'index.html',
  'styles.css',
  'preview.js',
  'board.html',
  'board.css',
  'poster.jpg',
  'a.jpg',
  'b.jpg',
  'c.jpg',
  'd.jpg',
]) {
  await cp(path.join(source, name), path.join(target, name));
}
await cp(path.join(root, 'client/assets/themes/daylight-sky.png'), path.join(target, 'sky.png'));
const bytes = (
  await Promise.all(
    (await readdir(target)).map(async (name) => (await stat(path.join(target, name))).size),
  )
).reduce((a, b) => a + b, 0);
console.log(
  `Static four-design showcase: ${target} (${(bytes / 1048576).toFixed(2)} MiB). No Worker or room bindings.`,
);
