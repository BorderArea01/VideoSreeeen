import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { _electron as electron } from 'playwright';

const installer = resolve('artifacts/windows/VideoSreeeen-Setup.exe');
const info = await stat(installer),
  yaml = await readFile('artifacts/windows/latest.yml', 'utf8');
const root = await mkdtemp(resolve('.local/update-check-'));
let corrupt = false;
const server = createServer((req, res) => {
  if (req.url === '/') {
    res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end('<!doctype html><title>Update verification</title>');
    return;
  }
  if (req.url?.startsWith('/latest.yml')) {
    const text = corrupt
      ? yaml.replace(/sha512: .+/g, 'sha512: ' + Buffer.alloc(64).toString('base64'))
      : yaml;
    res.writeHead(200, { 'Content-Type': 'text/yaml' }).end(text);
    return;
  }
  if (req.url?.startsWith('/VideoSreeeen-Setup.exe')) {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': corrupt ? 1024 : info.size,
    });
    createReadStream(installer, corrupt ? { start: 0, end: 1023 } : {}).pipe(res);
    return;
  }
  res.writeHead(404).end();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
await writeFile(
  join(root, 'update.yml'),
  `provider: generic\nurl: ${origin}\nupdaterCacheDirName: windows\n`,
);
const app = await electron.launch({
  args: ['desktop/main.cjs', '--mute-audio'],
  env: { ...process.env, VS_DEV_URL: origin },
  timeout: 30000,
});
try {
  await app.firstWindow();
  await app.evaluate('globalThis.__name = (value) => value; undefined');
  const run = async (name: string) =>
    app.evaluate(
      async ({ app }, input) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(input.module + '/package.json');
        const path = require('node:path');
        const { NsisUpdater } = require(input.module);
        const { ElectronHttpExecutor } = require(
          path.join(input.module, 'out/electronHttpExecutor.js'),
        );
        const base = path.join(input.root, input.name);
        require('node:fs').mkdirSync(base, { recursive: true });
        const updater = new NsisUpdater(null, {
          version: '0.3.1',
          name: 'VideoSreeeen-update-fixture',
          isPackaged: true,
          appUpdateConfigPath: path.join(input.root, 'update.yml'),
          userDataPath: base,
          baseCachePath: base,
          whenReady: () => Promise.resolve(),
          onQuit: () => {},
          quit: () => {
            throw new Error('Installation must never run in this test');
          },
          relaunch: () => {},
        });
        updater.httpExecutor = new ElectronHttpExecutor(() => {});
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        updater.disableDifferentialDownload = true;
        updater.disableWebInstaller = true;
        updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
        const update = await updater.checkForUpdates();
        if (!update || update.updateInfo.version !== '0.4.0')
          throw new Error('Update metadata not loaded');
        const files = await updater.downloadUpdate();
        let bytes = 0;
        const hash = require('node:crypto').createHash('sha256');
        for await (const chunk of require('node:fs').createReadStream(files[0])) {
          hash.update(chunk);
          bytes += chunk.length;
        }
        return { version: update.updateInfo.version, bytes, sha256: hash.digest('hex') };
      },
      { module: resolve('node_modules/electron-updater'), root, name },
    );
  const result = await run('valid');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(installer)) hash.update(chunk);
  assert.equal(result.sha256, hash.digest('hex'));
  assert.equal(result.bytes, info.size);
  corrupt = true;
  await assert.rejects(() => run('invalid'), /checksum|sha512/i);
  await writeFile(
    '.local/update-evidence.json',
    JSON.stringify(
      { download: result, tamperedRejected: true, installationExecuted: false },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ download: result, tamperedRejected: true, installationExecuted: false }),
  );
} finally {
  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
  assert.ok(resolve(root).startsWith(resolve('.local') + sep));
  await rm(root, { recursive: true, force: true });
}
