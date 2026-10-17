import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const repo = 'BorderArea01/VideoSreeeen';
const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pkg = JSON.parse(await readFile('package.json', 'utf8')),
  tag = 'v' + pkg.version;
assert.equal(
  run('git', ['status', '--porcelain']),
  '',
  'Commit and push the validated source before publishing',
);
const commit = run('git', ['rev-parse', 'HEAD']);
assert.equal(
  JSON.parse(run('gh', ['api', `repos/${repo}/git/ref/heads/main`])).object.sha,
  commit,
  'Push main before publishing',
);
const list = JSON.parse(run('gh', ['api', `repos/${repo}/releases?per_page=100`]));
assert.ok(
  !list.some((r) => r.tag_name === tag),
  'A release with this version already exists; published assets are immutable',
);
const directory = `artifacts/release/${pkg.version}`;
const names = await readdir(directory);
assert.deepEqual(
  [...names].sort(),
  [
    'update.json',
    'SHA256SUMS.txt',
    'latest.yml',
    'VideoSreeeen-Setup.exe',
    'VideoSreeeen-Setup.exe.blockmap',
    `VideoSreeeen ${pkg.version}.exe`,
    'VideoSreeeen-Android.apk',
  ].sort(),
);
for (const required of [
  'update.json',
  'SHA256SUMS.txt',
  'latest.yml',
  'VideoSreeeen-Setup.exe',
  'VideoSreeeen-Android.apk',
])
  assert.ok(names.includes(required));
assert.equal(
  JSON.parse(await readFile(join(directory, 'update.json'), 'utf8')).version,
  pkg.version,
);
// Keep a failed upload as a draft. Never publish an incomplete set of clients.
run('gh', [
  'release',
  'create',
  tag,
  '--repo',
  repo,
  '--target',
  commit,
  '--draft',
  '--title',
  `VideoSreeeen ${pkg.version}`,
  '--notes-file',
  'docs/release-notes.md',
]);
run('gh', [
  'release',
  'upload',
  tag,
  '--repo',
  repo,
  ...names.map((name) => join(directory, name)),
]);
const result = JSON.parse(run('gh', ['api', `repos/${repo}/releases/tags/${tag}`]));
assert.equal(result.assets.length, names.length);
run('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest']);
console.log(`Published https://github.com/${repo}/releases/tag/${tag} at ${commit}`);
