import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

// Run through controlled.ps1. Requires ffmpeg on PATH, or VS_FFMPEG pointing
// to an existing executable. These are generated clips, never site downloads.
await mkdir('.local', { recursive: true });
for (const [name, input, codec] of [
  [
    'native-hd-video.mp4',
    'color=c=0x25212c:s=1920x1080:r=4',
    ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
  ],
  ['native-hd-audio.m4a', 'sine=frequency=440:sample_rate=48000', ['-c:a', 'aac', '-b:a', '96k']],
]) {
  const result = spawnSync(
    process.env.VS_FFMPEG || 'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      input,
      '-t',
      '70',
      ...codec,
      '-threads',
      '1',
      '-movflags',
      '+faststart',
      '.local/' + name,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  assert.equal(
    result.status,
    0,
    'Generating the fixture failed; check VS_FFMPEG / ffmpeg availability',
  );
}
const child = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'scripts/extension-check.ts'],
  {
    windowsHide: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  },
);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
