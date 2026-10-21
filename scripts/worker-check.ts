import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { RELAY_MIMES, relayPacket } from '../shared/broadcast-relay';
import { voicePacket, bytesUuid } from '../shared/voice';
import { randomUUID } from 'node:crypto';
import { Response as MockResponse } from 'miniflare';
import { metadataFixture, playerFixture } from '../tests/site-source.fixture';
const sourceFixture = metadataFixture(await playerFixture());

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
          run_worker_first: [
            '/ws',
            '/broadcast-relay',
            '/voice',
            '/healthz',
            '/config',
            '/cache-plan/*',
            '/media/*',
            '/images/*',
            '/resolve-source/*',
          ],
        },
      },
      {
        name: 'videosreeeen-test',
        outboundService: async (request) => {
          assert.match(request.headers.get('User-Agent') ?? '', /VideoSreeeen\//);
          const response = await sourceFixture.fetch(request.url);
          return new MockResponse(await response.text(), { status: response.status });
        },
        scriptPath: '.local/worker-build/index.js',
        modules: true,
        compatibilityDate: '2026-10-01',
        compatibilityFlags: ['nodejs_compat'],
        durableObjects: { ROOMS: { className: 'WatchRoom', useSQLite: true } },
        assets: {
          directory: 'dist',
          binding: 'ASSETS',
          routerConfig: { has_user_worker: true },
          run_worker_first: [
            '/ws',
            '/broadcast-relay',
            '/voice',
            '/healthz',
            '/config',
            '/cache-plan/*',
            '/media/*',
            '/images/*',
            '/resolve-source/*',
          ],
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
  assert.equal(config.broadcastRelay, true);
  const a = await client('ABC234');
  a.send({ type: 'create', name: 'a', protocol: 1, capabilities: ['latency-v1'] });
  const welcome = await a.next('welcome');
  a.send(await a.next('probe'));
  await a.next('latency');
  const unknownSource = await fetch(origin + '/resolve-source/ABC234', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(unknownSource.status, 401);
  const sourceResult = await fetch(origin + '/resolve-source/ABC234', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + welcome.resume, 'X-Member-Id': welcome.memberId },
    body: JSON.stringify({ url: 'https://www.mgnacg.com/bangumi/193-3-17/' }),
  });
  assert.equal(sourceResult.status, 200, await sourceResult.clone().text());
  assert.equal(
    ((await sourceResult.json()) as any).media.source.video,
    'https://r2.jzacg.com/example/episode.mp4?Authorization=public-fixture-token',
  );
  assert.equal(sourceFixture.requests.length, 3);
  evidence.siteSource = {
    authenticated: true,
    publicMetadataDecoded: true,
    mediaBytesForwarded: false,
  };
  const b = await client('ABC234');
  b.send({ type: 'join', name: 'b', invite: welcome.room.invite, protocol: 1 });
  const bw = await b.next('welcome');
  async function voiceClient(welcome: any) {
    const socket = new WebSocket(origin.replace('http', 'ws') + '/voice?room=ABC234', { origin });
    sockets.push(socket);
    const messages: Array<any> = [];
    socket.on('message', (raw, binary) =>
      messages.push(binary ? new Uint8Array(raw as Buffer) : JSON.parse(String(raw))),
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const session = randomUUID();
    socket.send(
      JSON.stringify({
        type: 'hello',
        code: 'ABC234',
        member: welcome.memberId,
        secret: welcome.resume,
        session,
        opus: true,
      }),
    );
    const until = Date.now() + 5000;
    while (!messages.some((m) => m.type === 'roster')) {
      assert.ok(Date.now() < until, 'Voice roster through Pages binding');
      await new Promise((r) => setTimeout(r, 20));
    }
    return { socket, messages, session };
  }
  const voiceA = await voiceClient(welcome),
    voiceB = await voiceClient(bw);
  voiceA.socket.send(JSON.stringify({ type: 'mute', muted: false }));
  voiceA.socket.send(voicePacket(voiceA.session, 0, 'opus', [new Uint8Array([1, 2, 3])]));
  const voiceUntil = Date.now() + 5000;
  while (!voiceB.messages.some((m) => m instanceof Uint8Array)) {
    assert.ok(Date.now() < voiceUntil, 'Voice binary relay');
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(
    bytesUuid(voiceB.messages.find((m) => m instanceof Uint8Array)!.subarray(4, 20)),
    welcome.memberId,
  );
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
  await new Promise((r) => setTimeout(r, 100));
  assert.notEqual(voiceA.socket.readyState, WebSocket.OPEN);
  assert.notEqual(voiceB.socket.readyState, WebSocket.OPEN);
  const freshVoice = await voiceClient(welcome);
  freshVoice.socket.close();
  evidence.voice = {
    pagesBinding: true,
    authenticatedFanout: true,
    hibernationClosesEphemeralAudio: true,
    freshSessionAfterWake: true,
  };
  const image = Buffer.concat([
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    Buffer.alloc(2 * 1024 * 1024),
  ]);
  const upload = await fetch(origin + '/images/ABC234', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + welcome.resume, 'X-Member-Id': welcome.memberId },
    body: image,
  });
  assert.equal(upload.status, 201, await upload.clone().text());
  const imageId = ((await upload.json()) as any).id;
  await runtime.unsafeEvictDurableObject('videosreeeen-test', 'WatchRoom', {
    name: 'ABC234',
    webSockets: 'hibernate',
  });
  const original = await fetch(origin + '/images/ABC234/' + imageId);
  assert.equal(original.status, 200, await original.clone().text());
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), image);
  evidence.largeImage = { bytes: image.length, originalPreserved: true, hibernation: true };
  evidence.hibernation = { liveSocketsPreserved: true, chatPreserved: true };
  a.clear();
  await new Promise((resolve) => setTimeout(resolve, 5100));
  a.send({ type: 'ping', sentAt: 123 });
  assert.equal((await a.next('pong')).sentAt, 123);
  const probe = await a.next('probe');
  a.send(probe);
  const latency = await a.next('latency');
  assert.equal(typeof latency.members.find((m: any) => m.id === welcome.memberId).rtt, 'number');
  a.send({ type: 'snapshot' });
  const withRTT = await a.next('state');
  assert.equal(
    typeof withRTT.room.members.find((m: any) => m.id === welcome.memberId).rtt,
    'number',
  );
  a.clear();
  b.clear();
  a.send({
    type: 'media',
    base: withRTT.room.revision,
    op: 'relay-start',
    media: {
      url: 'https://example.com/screen',
      title: 'relay',
      provider: 'local',
      broadcast: { host: welcome.memberId, kind: 'screen' },
    },
  });
  const live = (await a.next('state')).room;
  async function mediaClient(identity: any) {
    const socket = new WebSocket(origin.replace('http', 'ws') + '/broadcast-relay?room=ABC234', {
      origin,
    });
    sockets.push(socket);
    const messages: any[] = [];
    socket.on('message', (raw, binary) =>
      messages.push(binary ? Buffer.from(raw as Buffer) : JSON.parse(String(raw))),
    );
    await onceOpen(socket);
    socket.send(
      JSON.stringify({
        type: 'hello',
        code: 'ABC234',
        member: identity.memberId,
        secret: identity.resume,
        media: live.media.id,
        epoch: live.epoch,
        formats: [...RELAY_MIMES],
      }),
    );
    const next = async (predicate: (message: any) => boolean) => {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('Missing relay response');
    };
    await next((message) => message.type === 'ready');
    return {
      socket,
      next,
      clear: () => {
        messages.length = 0;
      },
    };
  }
  async function onceOpen(socket: WebSocket) {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
  }
  const sender = await mediaClient(welcome),
    receiver = await mediaClient(bw);
  await sender.next((message) => message.type === 'need' && message.formats.length === 1);
  const session = '1234567890abcdef1234567890abcdef';
  const start = { type: 'start', session, mime: RELAY_MIMES[0] };
  const packet = relayPacket(session, 0, new Uint8Array([1, 2, 3, 4]));
  sender.socket.send(JSON.stringify(start));
  await receiver.next((message) => message.type === 'start');
  sender.socket.send(packet);
  assert.deepEqual(await receiver.next((message) => Buffer.isBuffer(message)), Buffer.from(packet));
  sender.clear();
  receiver.clear();
  await runtime.unsafeEvictDurableObject('videosreeeen-test', 'WatchRoom', {
    name: 'ABC234',
    webSockets: 'hibernate',
  });
  sender.socket.send('{"type":"ping"}');
  await sender.next((message) => message.type === 'need' && message.formats.length === 1);
  sender.socket.send(JSON.stringify(start));
  await receiver.next((message) => message.type === 'start');
  sender.socket.send(packet);
  assert.deepEqual(await receiver.next((message) => Buffer.isBuffer(message)), Buffer.from(packet));
  a.clear();
  a.send({ type: 'snapshot' });
  const afterRelay = await a.next('state');
  assert.equal(
    afterRelay.room.members.filter((member: any) => member.online).length,
    2,
    'Media sockets must not replace room membership sockets',
  );
  a.clear();
  a.send({ type: 'unshare', base: afterRelay.room.revision, op: 'relay-stop' });
  await a.next('state');
  await new Promise((r) => setTimeout(r, 100));
  assert.notEqual(sender.socket.readyState, WebSocket.OPEN);
  assert.notEqual(receiver.socket.readyState, WebSocket.OPEN);
  evidence.broadcastRelay = {
    binaryRoundTrip: true,
    hibernationRecovery: true,
    isolatedMembership: true,
    stopCleanup: true,
  };
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
  evidence.noSourceVideoProxy = true;
  await mkdir('.local', { recursive: true });
  await writeFile('.local/worker-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  for (const socket of sockets) socket.terminate();
  await runtime.dispose();
}
