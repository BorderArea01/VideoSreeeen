import { waitForNativeSample } from './native-sample';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { configureRoomServer, openRoom, closeInvitation, selectSource } from './room-ui';
import assert from 'node:assert/strict';
import { createApp } from '../server/index';
import { once } from 'node:events';
const local = process.env.VS_PUBLIC_URL ? undefined : createApp();
if (local) {
  local.server.listen(0, '127.0.0.1');
  await once(local.server, 'listening');
}
const origin =
  process.env.VS_PUBLIC_URL || 'http://127.0.0.1:' + (local!.server.address() as any).port;
const ui = origin;
const executablePath = process.env.VS_PACKAGED_EXE;
await mkdir('.local', { recursive: true });
const profile = await mkdtemp(resolve('.local/native-origin-'));
const apps: ElectronApplication[] = [];
const proof: any = {
  origin,
  network: 'system-default',
  isolatedProfiles: true,
  screenCapture: false,
  commonCache: false,
  packaged: !!executablePath,
  sites: [],
};
try {
  for (const name of ['pair-host', 'pair-guest']) {
    await mkdir(join(profile, name), { recursive: true });
    const entry = join(profile, name + '.cjs');
    await writeFile(
      entry,
      `const {app}=require('electron');require('node:fs').mkdirSync(${JSON.stringify(join(profile, name))},{recursive:true});app.setPath('userData',${JSON.stringify(join(profile, name))});require(${JSON.stringify(resolve('desktop/main.cjs'))});`,
    );
    const app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        executablePath ? '--user-data-dir=' + join(profile, name) : entry,
        '--mute-audio',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
      env: { ...process.env, VS_DEV_URL: executablePath ? '' : ui },
      timeout: 30000,
    });
    apps.push(app);
    await app.firstWindow();
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), join(profile, name));
    proof.clientVersion = await app.evaluate(({ app }) => app.getVersion());
    await app.evaluate(({ BrowserWindow, app }) => {
      BrowserWindow.getAllWindows().forEach((w) => w.hide());
      return true;
    });
  }
  const host = await apps[0].firstWindow(),
    guest = await apps[1].firstWindow();
  let state: any;
  host.on('websocket', (s) =>
    s.on('framereceived', (e) => {
      try {
        const m = JSON.parse(String(e.payload));
        if (m.room) state = m.room;
      } catch {}
    }),
  );
  await configureRoomServer(host, origin);
  await openRoom(host);
  await host.locator('#name-input').fill('Windows 原站播放 A');
  await host.locator('#create-button').click();
  await host.locator('#invite-dialog').waitFor();
  const invite = await host.locator('#invite-link').inputValue();
  await closeInvitation(host);
  await openRoom(guest, 'join');
  await guest.locator('#invite-input').fill(invite);
  await guest.locator('#name-input').fill('Windows 原站播放 B');
  await guest.locator('#join-button').click();
  await host.locator('#member-count').filter({ hasText: '2' }).waitFor();
  const confirm = async (predicate: () => boolean) => {
    const end = Date.now() + 15000;
    while (!predicate()) {
      assert.ok(Date.now() < end, 'Authoritative state did not match requested control');
      await host.waitForTimeout(100);
    }
  };
  const sample = async (page: Page) => page.evaluate(() => window.desktop!.call('sampleSite'));
  for (const [name, url] of [
    ['bilibili', 'https://www.bilibili.com/video/BV13Aa66LEAW/'],
    ['mgn', 'https://www.mgnacg.com/bangumi/193-3-17/'],
  ]) {
    if (process.argv[2] && process.argv[2] !== name) continue;
    const p: any = { name, url };
    proof.sites.push(p);
    console.log('testing native pair', name);
    const began = Date.now();
    try {
      await selectSource(host, url);
      for (const page of [host, guest])
        await waitForNativeSample(
          page,
          (s) =>
            s.available && Math.abs((s.duration ?? 0) - (name === 'bilibili' ? 164 : 1420.224)) < 2,
        );
      p.readyMs = Date.now() - began;
      await guest.locator('#play-button').click();
      await confirm(() => state.playback.paused === false);
      for (const page of [host, guest])
        await waitForNativeSample(
          page,
          (s) => s.available && !s.paused && (s.position ?? 0) > 1,
          15000,
        );
      await guest.locator('#play-button').click();
      await confirm(() => state.playback.paused === true);
      for (const page of [host, guest]) await waitForNativeSample(page, (s) => s.paused === true);
      await host.locator('#seek').evaluate((el) => {
        (el as HTMLInputElement).value = '5';
      });
      await host.locator('#seek').dispatchEvent('change');
      await confirm(() => state.playback.position === 5);
      for (const page of [host, guest])
        await waitForNativeSample(page, (s) => Math.abs((s.position ?? -1) - 5) < 0.3);
      await guest.locator('#rate').selectOption('1.25');
      await confirm(() => state.playback.rate === 1.25);
      for (const page of [host, guest])
        await waitForNativeSample(page, (s) => Math.abs((s.rate ?? 0) - 1.25) < 0.01);
      await host.waitForTimeout(1000);
      p.players = [];
      for (const page of [host, guest]) {
        const s = await sample(page);
        assert.equal(s.paused, true);
        assert.ok(Math.abs(s.position - 5) < 0.3);
        assert.equal(s.rate, 1.25);
        p.players.push({ position: s.position, rate: s.rate, paused: s.paused });
      }
      p.decoding = [];
      for (const app of apps)
        p.decoding.push(
          await app.evaluate(async ({ webContents }) => {
            const out: any[] = [];
            for (const wc of webContents.getAllWebContents()) {
              if (!wc.getURL().startsWith('https:') || wc.getURL().includes('pages.dev')) continue;
              for (const frame of wc.mainFrame.framesInSubtree)
                try {
                  const v = await frame.executeJavaScript(
                    `(()=>{const v=[...document.querySelectorAll('video')].find(v=>v.duration>1);return v?{width:v.videoWidth,height:v.videoHeight,frames:v.getVideoPlaybackQuality().totalVideoFrames,audioBytes:v.webkitAudioDecodedByteCount}:null})()`,
                  );
                  if (v) out.push(v);
                } catch {}
            }
            return out;
          }),
        );
      for (const videos of p.decoding)
        assert.ok(videos.some((v: any) => v.width > 0 && v.frames > 10 && v.audioBytes > 0));
      const applied = await apps[0].evaluate(async ({ webContents }) => {
        for (const wc of webContents.getAllWebContents()) {
          if (!wc.getURL().startsWith('https:') || wc.getURL().includes('pages.dev')) continue;
          for (const frame of wc.mainFrame.framesInSubtree)
            try {
              if (
                await frame.executeJavaScript(
                  `(()=>{const v=[...document.querySelectorAll('video')].find(v=>v.duration>1);if(!v)return false;v.dispatchEvent(new Event('pointerdown',{bubbles:true}));v.currentTime=8;return true;})()`,
                  true,
                )
              )
                return true;
            } catch {}
        }
        return false;
      });
      assert.equal(applied, true);
      await confirm(() => Math.abs(state.playback.position - 8) < 0.3);
      for (const page of [host, guest])
        await waitForNativeSample(page, (s) => Math.abs((s.position ?? -1) - 8) < 0.3);
      p.originalPlayerGestureSynced = true;
      p.authoritative = {
        position: state.playback.position,
        paused: state.playback.paused,
        rate: state.playback.rate,
      };
      p.passed = true;
      console.log(JSON.stringify(p));
    } catch (e: any) {
      p.error = e.message;
      p.lastState = state?.playback;
      p.media = state?.media
        ? { provider: state.media.provider, url: state.media.url, id: state.media.id }
        : null;
      p.ui = [];
      for (const page of [host, guest])
        p.ui.push(
          await page.evaluate(() => ({
            native: !!window.desktop,
            toast: document.querySelector('#toast')?.textContent,
            link: document.querySelector('#link-error')?.textContent,
            server: document.querySelector('#connection')?.textContent,
          })),
        );
      p.lastSamples = [];
      for (const page of [host, guest])
        try {
          const s = await sample(page);
          p.lastSamples.push({
            available: s.available,
            position: s.position,
            rate: s.rate,
            paused: s.paused,
            duration: s.duration,
            seq: s.seq,
            action: s.action,
          });
        } catch {}
      p.contents = [];
      for (const app of apps)
        p.contents.push(
          await app.evaluate(({ webContents }) =>
            webContents.getAllWebContents().map((w) => ({
              id: w.id,
              url: w.getURL().split('?')[0],
              destroyed: w.isDestroyed(),
            })),
          ),
        );
      p.passed = false;
      console.log(JSON.stringify(p));
    }
  }
  await host.locator('#leave-button').evaluate((el) => (el as HTMLButtonElement).click());
  await guest.locator('#leave-button').evaluate((el) => (el as HTMLButtonElement).click());
} finally {
  await writeFile('.local/native-origin-evidence.json', JSON.stringify(proof, null, 2));
  for (const app of apps) await app.close();
  await local?.close();
}
if (proof.sites.some((p: { passed?: boolean }) => !p.passed)) process.exitCode = 1;
