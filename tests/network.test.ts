import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createApp } from '../server/index';
import { assertPublicAddress, hlsLines, hlsVariants, publicTarget } from '../server/media';

function messages(ws: WebSocket) {
  const queue: any[] = [];
  const waiters: { type: string; resolve: (data: any) => void }[] = [];
  ws.on('message', (raw) => {
    const data = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.type === data.type);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(data);
    else queue.push(data);
  });
  return (type: string) => {
    const i = queue.findIndex((x) => x.type === type);
    if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待消息超时：' + type)), 3000);
      waiters.push({
        type,
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
      });
    });
  };
}
test('真实 WebSocket：建房、邀请、双端聊天、错误来源拦截、健康检查和关闭', async () => {
  const app = createApp();
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const port = (app.server.address() as any).port;
  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`),
    b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const getA = messages(a),
    getB = messages(b);
  try {
    await Promise.all([once(a, 'open'), once(b, 'open')]);
    a.send(JSON.stringify({ type: 'create', name: '甲', protocol: 1 }));
    const welcome = await getA('welcome');
    b.send(JSON.stringify({ type: 'join', name: '乙', protocol: 1, invite: welcome.room.invite }));
    const joined = await getB('welcome');
    assert.equal(joined.room.members.length, 2);
    b.send(JSON.stringify({ type: 'chat', text: '一起看 🍿' }));
    let state;
    do {
      state = await getA('state');
    } while (!state.room.chat.length);
    assert.equal(state.room.chat[0].text, '一起看 🍿');
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'https://evil.example' });
    await assert.rejects(once(bad, 'open'));
    bad.terminate();
    assert.equal(
      ((await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()) as any).ok,
      true,
    );
    assert.equal((await fetch(`http://127.0.0.1:${port}/media/ABC234/wrong/video`)).status, 404);
    const desktop = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'file://' });
    await once(desktop, 'open');
    desktop.terminate();
  } finally {
    a.terminate();
    b.terminate();
    await app.close();
  }
});
test('媒体代理拒绝内网、回环、映射 IPv6、保留 IP 和非 HTTP 协议', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '100.64.1.1',
    '224.0.0.1',
  ])
    assert.throws(() => assertPublicAddress(address), address);
  assert.doesNotThrow(() => assertPublicAddress('8.8.8.8'));
  await assert.rejects(publicTarget('file:///etc/passwd'));
  await assert.rejects(publicTarget('http://127.0.0.1/video.mp4'));
  await assert.rejects(publicTarget('https://example.com:22/'));
});
test('HLS 验证：有效主列表解析，拒绝加密、范围分片和伪造列表', () => {
  const lines = hlsLines('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nlow/index.m3u8\n');
  assert.equal(
    hlsVariants(lines, 'https://example.com/root.m3u8')[0]!.url,
    'https://example.com/low/index.m3u8',
  );
  assert.throws(() => hlsLines('<html>not video</html>'));
  assert.throws(() => hlsLines('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"'));
  assert.throws(() => hlsLines('#EXTM3U\n#EXT-X-BYTERANGE:123\na.ts'));
});
