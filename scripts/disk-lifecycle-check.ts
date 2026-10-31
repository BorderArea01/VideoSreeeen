import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Run the real cache classes in a separate localhost origin, never a user room.
const ui = await build({
  stdin: {
    contents: `import {BrowserDiskCache} from './client/disk-cache'; window.diskFixture=BrowserDiskCache;`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  write: false,
});
const worker = await build({
  entryPoints: ['client/disk-cache-worker.ts'],
  bundle: true,
  format: 'esm',
  write: false,
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'text/javascript');
  res.end(
    req.url === '/'
      ? '<script type="module" src="/fixture.js"></script>'
      : req.url === '/fixture.js'
        ? ui.outputFiles[0]!.contents
        : worker.outputFiles[0]!.contents,
  );
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
});
const proof: any = { at: new Date().toISOString(), production: false, realPhone: false };
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + (server.address() as any).port);
  await page.waitForFunction(() => (window as any).diskFixture);
  proof.checks = await page.evaluate(async () => {
    const Cache = (window as any).diskFixture;
    const root = await navigator.storage.getDirectory();
    const first = await Cache.create(
      crypto.randomUUID(),
      [{ name: 'video.mp4', size: 262144 }],
      new AbortController().signal,
    );
    await first.put('video.mp4', 0, new Uint8Array(262144));
    const app = await root.getDirectoryHandle('videosreeeen-disk');
    let locked: { name: string; message: string } | undefined;
    const entries = [];
    for await (const name of (app as any).keys()) entries.push(name);
    try {
      await app.removeEntry(entries[0], { recursive: true });
    } catch (cause) {
      if (cause instanceof DOMException) locked = { name: cause.name, message: cause.message };
      else throw cause;
    }
    const other = await Cache.create(
      crypto.randomUUID(),
      [{ name: 'video.mp4', size: 1 }],
      new AbortController().signal,
    );
    await other.put('video.mp4', 0, new Uint8Array([7]));
    await Promise.all([first.clear(), first.clear(), first.clear()]);
    const retained = await other.get('video.mp4', 0);
    await other.clear();
    for (let n = 0; n < 6; n++) {
      const store = await Cache.create(
        crypto.randomUUID(),
        [{ name: 'video.mp4', size: 16 }],
        new AbortController().signal,
      );
      await store.put('video.mp4', 0, new Uint8Array(16));
      await store.clear();
    }
    for (let n = 0; n < 3; n++) {
      const controller = new AbortController();
      const pending = Cache.create(
        crypto.randomUUID(),
        [{ name: 'video.mp4', size: 16 }],
        controller.signal,
      );
      controller.abort();
      try {
        await pending;
        throw new Error('Aborted initialization succeeded');
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) throw cause;
      }
    }
    const remaining = [];
    for await (const name of (app as any).keys()) remaining.push(name);
    const locks = await navigator.locks.query();
    return {
      locked,
      concurrentClear: true,
      otherJobByte: retained[0],
      remaining,
      heldCacheLocks: locks.held?.filter((l) => l.name?.startsWith('videosreeeen-disk:')).length,
    };
  });
  assert.equal(proof.checks.locked?.name, 'NoModificationAllowedError');
  assert.equal(proof.checks.otherJobByte, 7);
  assert.deepEqual(proof.checks.remaining, []);
  assert.equal(proof.checks.heldCacheLocks, 0);
  proof.checksPassed = true;
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
  proof.cleanup = true;
  proof.passed = proof.checksPassed === true;
  await writeFile('.local/disk-lifecycle-evidence.json', JSON.stringify(proof, null, 2));
}
console.log(JSON.stringify(proof, null, 2));
