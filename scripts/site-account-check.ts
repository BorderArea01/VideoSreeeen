import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { _electron as electron } from 'playwright';
import { createApp } from '../server/index';
import { openRoom, closeInvitation, selectSource, useOriginalBilibili } from './room-ui';

// Synthetic credentials only, in a fresh application profile. Never inspect the
// user's browser or real Bilibili cookies.
await mkdir('.local', { recursive: true });
const profile = await mkdtemp(resolve('.local/account-check-'));
const entry = join(profile, 'entry.cjs');
await writeFile(
  entry,
  `const {app}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});
require(${JSON.stringify(resolve('desktop/main.cjs'))});`,
);
const server = createApp();
server.server.listen(0, '127.0.0.1');
await once(server.server, 'listening');
const origin = `http://127.0.0.1:${(server.server.address() as { port: number }).port}`;
const executablePath = process.env.VS_PACKAGED_EXE;
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
const proof: Record<string, unknown> = { realAccountUsed: false, isolatedProfile: true };
try {
  for (let launch = 0; launch < 2; launch++) {
    app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath
        ? ['--user-data-dir=' + profile, '--mute-audio']
        : [entry, '--mute-audio'],
      env: { ...process.env, VS_DEV_URL: executablePath ? '' : origin },
    });
    const main = await app.firstWindow();
    assert.equal(
      await app.evaluate(({ app }) => app.getPath('userData')),
      profile,
      'Refusing to inspect any session outside the isolated test profile',
    );
    if (launch === 0) {
      await app.evaluate(async ({ session }) => {
        await session.fromPartition('persist:sites').cookies.set({
          url: 'https://session-check.invalid',
          name: 'vs_session_test',
          value: 'synthetic',
          expirationDate: Date.now() / 1000 + 3600,
          secure: true,
          httpOnly: true,
        });
        await session.fromPartition('persist:sites').cookies.flushStore();
      });
    }
    assert.equal(
      await app.evaluate(async ({ session }) => {
        return (
          (
            await session
              .fromPartition('persist:sites')
              .cookies.get({ domain: 'session-check.invalid' })
          ).length === 1 &&
          (await session.defaultSession.cookies.get({ domain: 'session-check.invalid' })).length ===
            0
        );
      }),
      true,
    );
    if (launch === 0) {
      await main.locator('#settings-button').click();
      await main.locator('#site-account-settings > summary').click();
      const opened = app.waitForEvent('window');
      await main.locator('#site-account-login').click();
      const account = await opened;
      await account.waitForURL('https://passport.bilibili.com/**');
      await account.waitForLoadState('domcontentloaded');
      assert.equal(
        await account.evaluate(
          () => typeof window.desktop === 'undefined' && typeof window.VSNative === 'undefined',
        ),
        true,
      );
      assert.equal(
        await app.evaluate(({ BrowserWindow, session }) => {
          return (
            BrowserWindow.getAllWindows().length === 2 &&
            BrowserWindow.getAllWindows().every(
              (w) =>
                !w.webContents.getURL().startsWith('https://passport.') ||
                w.webContents.session === session.fromPartition('persist:sites'),
            )
          );
        }),
        true,
      );
      await account.screenshot({ path: '.local/site-account-login.png' });
      proof.loginPageLoaded = true;
      await account.close();
      await main.locator('#site-account-status').filter({ hasText: '关闭登录窗口' }).waitFor();
      proof.originalWindowRetained = !main.isClosed();
      await main.locator('[data-close="settings-dialog"]').first().click();
      await openRoom(main);
      await main.locator('#name-input').fill('本机登录入口验收');
      await main.locator('#create-button').click();
      await closeInvitation(main);
      await useOriginalBilibili(main);
      await selectSource(main, 'https://www.bilibili.com/video/BV13Aa66LEAW/');
      await main.locator('#bili-login-button').waitFor();
      const quickOpened = app.waitForEvent('window');
      await main.locator('#bili-login-button').click();
      const quickAccount = await quickOpened;
      await quickAccount.waitForURL('https://passport.bilibili.com/login');
      await quickAccount.waitForLoadState('domcontentloaded');
      await main.locator('#bili-login-button').click();
      assert.equal(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
        2,
        'Repeated login clicks must reuse the existing official login window',
      );
      await quickAccount.screenshot({ path: '.local/site-account-common-login.png' });
      await quickAccount.close();
      assert.equal(main.isClosed(), false);
      await main.locator('#leave-button').click();
      proof.loginFromCommonPlayback = true;
      proof.repeatedLoginReusesWindow = true;
      proof.systemBrowserAuthorizationOffered = false;
      proof.realLoginConfirmed = false;
    } else proof.persistedAcrossRestart = true;
    await app.close();
    app = undefined;
  }
  proof.passed = true;
} finally {
  await app?.close();
  await server.close();
  await writeFile('.local/site-account-evidence.json', JSON.stringify(proof, null, 2));
}
console.log(JSON.stringify(proof));
