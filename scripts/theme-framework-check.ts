import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { createApp } from '../server/index';
import { closeInvitation, selectSource } from './room-ui';

// Source-module access is confined to this isolated dev server. No test bridge
// or registry mutation API is injected into the production application.
const allowedOrigins: string[] = [];
const app = createApp({ origins: allowedOrigins });
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const backend = `http://127.0.0.1:${(app.server.address() as any).port}`;
const vite = await createServer({
  configFile: false,
  root: resolve('client'),
  envDir: resolve('.'),
  base: '/',
  server: {
    host: '127.0.0.1',
    port: 0,
    proxy: { '/ws': { target: backend, ws: true }, '/config': backend, '/healthz': backend },
  },
  logLevel: 'error',
});
await vite.listen();
const origin = `http://127.0.0.1:${(vite.httpServer!.address() as any).port}`;
allowedOrigins.push(origin);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--mute-audio', '--disable-extensions', '--js-flags=--max-old-space-size=96'],
});
const proof: any = {
  at: new Date().toISOString(),
  production: false,
  sourceModules: true,
  realPhone: false,
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((backend) => {
    localStorage.setItem('videosreeeen.appearance', 'classic');
    localStorage.setItem('server', backend);
  }, backend);
  const data = await readFile('.local/flower.mp4');
  const movie = 'https://cache-fixture.videosreeeen.test/flower.mp4';
  await context.route(movie, (route) => route.fulfill({ body: data, contentType: 'video/mp4' }));
  await context.route(backend + '/config', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), mediaRelay: false, p2p: false },
    });
  });
  const page = await context.newPage();
  const errors: string[] = [],
    requests: string[] = [],
    operations: string[] = [];
  let watching = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      if (!watching) return;
      try {
        const m = JSON.parse(String(payload));
        if (['media', 'control', 'cache', 'mode', 'unshare'].includes(m.type))
          operations.push(m.type);
      } catch {}
    }),
  );
  await page.goto(origin);
  await page.waitForFunction(() => !document.documentElement.dataset.themeLoading);
  assert.ok(
    !requests.some((url) => /themes\/(?:daylight|signal)\/index|daylight-sky|\.woff2/.test(url)),
  );
  proof.defaultDoesNotLoadOptionalAssets = true;
  await page.locator('#hero-create').click();
  await page.locator('#name-input').fill('主题框架验收');
  await page.locator('#create-button').click();
  await closeInvitation(page);
  await selectSource(page, movie);
  await page.locator('#video').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.readyState >= 2,
  );
  await page.locator('#play-button').click();
  await page.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#video')!.currentTime > 0.2,
  );
  watching = true;
  proof.lifecycle = await page.evaluate(String.raw`(async()=>{
    const appearancePath='/appearance.ts',catalogPath='/themes/catalog.ts';
    const {themeController:controller}=await import(appearancePath),{themeRegistry:registry}=await import(catalogPath);
    const video=document.querySelector('#video'),audio=document.querySelector('#audio'),voice=document.querySelector('#voice-panel'),chat=document.querySelector('#chat-input');
    const identity=()=>video===document.querySelector('#video')&&audio===document.querySelector('#audio')&&voice===document.querySelector('#voice-panel')&&chat===document.querySelector('#chat-input');
    let loads=0;video.addEventListener('loadstart',()=>loads++);
    const scopes=[];
    function verify(condition,message){if(!condition)throw Error(message);}
    const zero=(scope)=>{const snapshot=scope.snapshot();return snapshot.disposed&&['nodes','listeners','observers','timers','frames'].every(key=>snapshot[key]===0);};
    for(let cycle=0;cycle<8;cycle++)for(const id of ['glitch','signal','classic']){
      const previous=controller.scope;
      verify(await controller.select(id),'Theme activation failed');
      if(previous){scopes.push(previous);verify(zero(previous),'Old theme retained resources');}
      verify(identity(),'Real application nodes replaced');
      verify(document.querySelectorAll('style[data-theme-style]').length===(id==='classic'?0:1),'Stale theme CSS');
      verify(document.querySelectorAll('#theme-photo').length===(id==='glitch'?1:0),'Stale daylight nodes');
      verify(document.querySelectorAll('#signal-field').length===(id==='signal'?1:0),'Stale signal nodes');
      if(id!=='signal')verify(!document.querySelector('.signal-control,.signal-panel,[data-signal-layer]'),'Signal decoration retained');
      if(id==='classic'){
        verify(!document.documentElement.hasAttribute('data-theme-layout'),'Stale layout state');
        verify(!document.querySelector('.theme-voice,.theme-members,.theme-utilities'),'Stale layout wrappers');
        const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT);let node;while(node=walker.nextNode())verify(node.textContent!=='appearance-home','Stale layout anchor');
      }
    }
    const removed=[];
    for(const id of ['glitch','signal']){
      const definition=registry.get(id);await controller.select(id);const scope=controller.scope;
      registry.unregister(id);
      verify(controller.snapshot().active==='classic'&&zero(scope),'Active removal did not restore default');
      verify(!document.querySelector('input[name="appearance"][value="'+id+'"]'),'Removed theme remains in picker');
      registry.register(definition);verify(await controller.select(id),'Reinserted theme failed');removed.push(id);
    }
    await controller.select('classic');
    let customScope,pings=0,late=0;
    registry.register({id:'test-theme',name:'测试主题',order:99,themeColor:'#123456',preview:{background:'#123456',panel:'#fff',accent:'#123456',border:'#fff'},load:async()=>({styles:[':root[data-theme="test-theme"] {--text: #123456;}'],mount(scope){
      customScope=scope;const node=scope.own(document.createElement('div'));node.dataset.testTheme='';document.body.append(node);
      scope.listen(window,'theme-probe',()=>pings++);scope.timeout(()=>late++,200);
      scope.observe(new MutationObserver(scope.guard(()=>{}))).observe(node,{childList:true});
    }})});
    verify(!!document.querySelector('input[value="test-theme"]'),'New theme is not discovered by picker');
    verify(await controller.select('test-theme'),'Third theme failed');window.dispatchEvent(new Event('theme-probe'));verify(pings===1,'Custom event not mounted');
    registry.unregister('test-theme');window.dispatchEvent(new Event('theme-probe'));
    await new Promise(done=>setTimeout(done,250));
    verify(zero(customScope)&&pings===1&&late===0&&!document.querySelector('[data-test-theme]'),'Removed third theme retained resources');
    let resolve;
    registry.register({id:'late-theme',name:'迟到主题',order:99,themeColor:'#123456',preview:{background:'#123456',panel:'#fff',accent:'#123456',border:'#fff'},load:()=>new Promise(done=>resolve=done)});
    const pending=controller.select('late-theme');await Promise.resolve();registry.unregister('late-theme');
    resolve({styles:[],mount(){throw Error('Late removed theme mounted');}});await pending;
    verify(controller.snapshot().active==='classic','Late theme changed active state');
    verify(identity()&&loads===0,'Theme lifecycle reloaded media');
    return {cycles:8,switches:24,releasedScopes:scopes.length,allReleased:scopes.every(zero),activeRemovalAndReinsert:removed,thirdThemeWithoutCoreChanges:true,lateLoadIgnored:true,sameMediaAndApplicationNodes:identity(),mediaLoads:loads};
  })()`);
  proof.noRoomOperations = operations.length === 0;
  assert.deepEqual(operations, []);
  assert.deepEqual(errors, []);
  proof.passed = true;
  await page.locator('#leave-button').click();
} catch (error) {
  proof.error = String(error);
  proof.passed = false;
  throw error;
} finally {
  await browser.close();
  await vite.close();
  app.close();
  proof.cleanup = true;
  await writeFile('.local/theme-framework-evidence.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}
