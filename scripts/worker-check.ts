import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'pages-entry',
        scriptPath: 'pages/_worker.js',
        modules: true,
        compatibilityDate: '2026-10-01',
        serviceBindings: { WATCH: 'videosreeeen-test' },
        assets: {
          directory: 'dist',
          binding: 'ASSETS',
          routerConfig: { has_user_worker: true },
          run_worker_first: ['/ws', '/healthz', '/config', '/cache-plan/*', '/media/*'],
        },
      },
      {
        name: 'videosreeeen-test',
        scriptPath: '.local/worker-build/index.js',
        modules: true,
        compatibilityDate: '2026-10-01',
        compatibilityFlags: ['nodejs_compat'],
        durableObjects: { ROOMS: { className: 'WatchRoom', useSQLite: true } },
        assets: {
          directory: 'dist',
          binding: 'ASSETS',
          routerConfig: { has_user_worker: true },
          run_worker_first: ['/ws', '/healthz', '/config', '/cache-plan/*', '/media/*'],
        },
        bindings: { ICE_SERVERS: '[]' },
      },
    ],
    port: 0,
    host: '127.0.0.1',
  }),
);
const origin = (await runtime.ready).origin;
const sockets: WebSocket[] = [],
  evidence: Record<string, unknown> = {};
async function client(code: string) {
  const socket = new WebSocket(origin.replace('http', 'ws') + '/ws?room=' + code, { origin });
  sockets.push(socket);
  const messages: any[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(String(raw))));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
    socket.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => reject(new Error(`Upgrade ${res.statusCode}: ${body.slice(0, 1500)}`)));
    });
  });
  return {
    socket,
    send: (m: unknown) => socket.send(JSON.stringify(m)),
    async next(type: string) {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const index = messages.findIndex((m) => m.type === type);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('Missing message: ' + type + '; received ' + JSON.stringify(messages));
    },
    clear: () => {
      messages.length = 0;
    },
  };
}
try {
  const health = await fetch(origin + '/healthz');
  assert.equal(health.status, 200, await health.text());
  const config = (await (await fetch(origin + '/config')).json()) as any;
  assert.equal(config.p2p, true);
  assert.equal(config.mediaRelay, false);
  const a = await client('ABC234');
  a.send({ type: 'create', name: 'a', protocol: 1 });
  const welcome = await a.next('welcome');
  const b = await client('ABC234');
  b.send({ type: 'join', name: 'b', invite: welcome.room.invite, protocol: 1 });
  const bw = await b.next('welcome');
  a.clear();
  b.clear();
  a.send({ type: 'chat', text: 'before hibernation' });
  await b.next('state');
  await runtime.unsafeEvictDurableObject('videosreeeen-test', 'WatchRoom', {
    name: 'ABC234',
    webSockets: 'hibernate',
  });
  a.clear();
  a.send({ type: 'snapshot' });
  const restored = await a.next('state');
  assert.equal(restored.room.chat.at(-1).text, 'before hibernation');
  assert.equal(restored.room.members.filter((m: any) => m.online).length, 2);
  evidence.hibernation = { liveSocketsPreserved: true, chatPreserved: true };
  a.clear();
  a.send({ type: 'ping', sentAt: 123 });
  assert.equal((await a.next('pong')).sentAt, 123);
  const probe = await a.next('probe');
  a.send(probe);
  const withRTT = await a.next('state');
  assert.equal(
    typeof withRTT.room.members.find((m: any) => m.id === welcome.memberId).rtt,
    'number',
  );
  b.socket.close();
  await new Promise((r) => setTimeout(r, 200));
  const replacement = await client('ABC234');
  replacement.send({
    type: 'join',
    name: 'b resumed',
    invite: welcome.room.invite,
    resume: bw.resume,
    protocol: 1,
  });
  const resumed = await replacement.next('welcome');
  assert.equal(resumed.memberId, bw.memberId);
  evidence.resume = true;
  const invalid = await client('ABC235');
  invalid.send({ type: 'join', name: 'outsider', invite: welcome.room.invite, protocol: 1 });
  assert.equal((await invalid.next('error')).code, 'invalid_invite');
  assert.equal((await fetch(origin + '/media/ABC234/anything/video')).status, 501);
  evidence.noVideoRelay = true;
  await mkdir('.local', { recursive: true });
  await writeFile('.local/worker-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  for (const socket of sockets) socket.terminate();
  await runtime.dispose();
}
