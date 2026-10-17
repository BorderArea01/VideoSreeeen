import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
const target = `artifacts/release/${pkg.version}`;
await mkdir(target, { recursive: true });
const names = ['VideoSreeeen-Setup.exe', 'VideoSreeeen-Setup.exe.blockmap', 'latest.yml'];
for (const name of names) await copyFile(join('artifacts/windows', name), join(target, name));
const portable = `VideoSreeeen-Portable-${pkg.version}.exe`;
await copyFile(
  join('artifacts/windows', `VideoSreeeen ${pkg.version}.exe`),
  join(target, portable),
);
await copyFile(
  'artifacts/android/VideoSreeeen-Android.apk',
  join(target, 'VideoSreeeen-Android.apk'),
);
assert.match(
  await readFile(join(target, 'latest.yml'), 'utf8'),
  new RegExp('version: ' + pkg.version.replaceAll('.', '\\.')),
);
async function digest(name) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(join(target, name))) hash.update(block);
  return hash.digest('hex');
}
const code = Number(
  (await readFile('android/app/build.gradle', 'utf8')).match(/versionCode\s+(\d+)/)?.[1],
);
assert.ok(code > 0);
const manifest = {
  version: pkg.version,
  android: {
    versionCode: code,
    url: `https://github.com/BorderArea01/VideoSreeeen/releases/download/v${pkg.version}/VideoSreeeen-Android.apk`,
    sha256: await digest('VideoSreeeen-Android.apk'),
    size: (await stat(join(target, 'VideoSreeeen-Android.apk'))).size,
  },
};
await writeFile(join(target, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
const files = [...names, portable, 'VideoSreeeen-Android.apk', 'update.json'];
await writeFile(
  join(target, 'SHA256SUMS.txt'),
  (await Promise.all(files.map(async (name) => (await digest(name)) + '  ' + name))).join('\n') +
    '\n',
);
console.log(`Prepared v${pkg.version}: ${files.length} assets plus SHA256SUMS.txt`);
