import test from 'node:test';
import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import { Rooms, RoomError } from '../server/rooms';
import { reconcile, positionAt } from '../shared/sync';
import { clientMessageSchema, parseInvite } from '../shared/protocol';
import { describeUrl } from '../shared/sites';
class Socket {
  readyState = 1;
  bufferedAmount = 0;
  messages: any[] = [];
  send(raw: string) {
    this.messages.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
  }
}
const socket = () => new Socket() as unknown as WebSocket;
const direct = {
  url: 'https://example.com/movie.mp4',
  title: 'Movie',
  provider: 'direct' as const,
  source: { kind: 'file' as const, video: 'https://example.com/movie.mp4' },
  duration: 120,
};
function fixture() {
  let now = 1000;
  const rooms = new Rooms(() => now);
  const a = socket(),
    b = socket();
  const { room, seat: first } = rooms.create('甲', a);
  const { seat: second } = rooms.join(`${room.code}:${room.token}`, '乙', b);
  return {
    rooms,
    room,
    first,
    second,
    a,
    b,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test('多人控制：相同版本只有第一条操作生效，过期操作不能覆盖', () => {
  const f = fixture();
  f.rooms.act(f.room, f.first, { type: 'media', op: 'media', base: 0, media: direct });
  const base = f.room.revision;
  f.rooms.act(f.room, f.first, { type: 'control', op: 'play', base, action: 'play' });
  assert.throws(
    () => f.rooms.act(f.room, f.second, { type: 'control', op: 'pause', base, action: 'pause' }),
    (e: any) => e instanceof RoomError && e.code === 'conflict',
  );
  assert.equal(f.room.playback.paused, false);
  f.advance(2000);
  assert.equal(positionAt(f.room.playback.position, false, 1, 2000), 2);
  f.rooms.act(f.room, f.second, {
    type: 'control',
    op: 'pause-new',
    base: f.room.revision,
    action: 'pause',
  });
  assert.equal(f.room.playback.position, 2);
});
test('重复操作去重，且不能冒用其他成员的操作编号', () => {
  const f = fixture();
  const m = { type: 'media' as const, op: 'same', base: 0, media: direct };
  f.rooms.act(f.room, f.first, m);
  const revision = f.room.revision;
  f.rooms.act(f.room, f.first, m);
  assert.equal(f.room.revision, revision);
  assert.throws(() => f.rooms.act(f.room, f.second, m));
});
test('首次识别同一原站的视频源保留当前时间线；换片仍重置进度', () => {
  const f = fixture();
  const page = {
    url: 'https://www.bilibili.com/video/BV13Aa66LEAW/',
    title: 'page',
    provider: 'bilibili' as const,
  };
  f.rooms.act(f.room, f.first, { type: 'media', op: 'page', base: 0, media: page });
  f.rooms.act(f.room, f.first, {
    type: 'control',
    op: 'seek',
    base: f.room.revision,
    action: 'seek',
    position: 10,
  });
  f.rooms.act(f.room, f.first, {
    type: 'control',
    op: 'rate',
    base: f.room.revision,
    action: 'rate',
    rate: 1.5,
  });
  f.rooms.act(f.room, f.first, {
    type: 'control',
    op: 'play',
    base: f.room.revision,
    action: 'play',
  });
  f.advance(2000);
  const id = f.room.media!.id,
    epoch = f.room.epoch;
  f.rooms.act(f.room, f.first, {
    type: 'media',
    op: 'source',
    base: f.room.revision,
    media: { ...page, source: direct.source, duration: 164 },
  });
  assert.equal(f.room.playback.position, 13);
  assert.equal(f.room.playback.paused, false);
  assert.equal(f.room.playback.rate, 1.5);
  assert.notEqual(f.room.media!.id, id);
  assert.ok(f.room.epoch > epoch);
  f.rooms.act(f.room, f.first, {
    type: 'media',
    op: 'other',
    base: f.room.revision,
    media: direct,
  });
  assert.equal(f.room.playback.position, 0);
  assert.equal(f.room.playback.paused, true);
});
test('共同缓存：所有成员完成相同内容后才可播放，旧代次完成消息不生效', () => {
  const f = fixture();
  f.rooms.act(f.room, f.first, { type: 'media', op: 'm', base: 0, media: direct });
  f.rooms.act(f.room, f.first, { type: 'mode', op: 'mode', base: f.room.revision, mode: 'cache' });
  const ready = {
    type: 'cache' as const,
    epoch: f.room.epoch,
    mediaId: f.room.media!.id,
    state: 'ready' as const,
    progress: 1,
    bytes: 1024,
    fingerprint: 'a'.repeat(64),
  };
  f.rooms.act(f.room, f.first, ready);
  assert.equal(f.rooms.cacheReady(f.room), false);
  assert.throws(
    () =>
      f.rooms.act(f.room, f.first, {
        type: 'control',
        op: 'p',
        base: f.room.revision,
        action: 'play',
      }),
    /等待/,
  );
  f.rooms.act(f.room, f.second, { ...ready, epoch: ready.epoch - 1 });
  assert.equal(f.rooms.cacheReady(f.room), false);
  f.rooms.act(f.room, f.second, { ...ready, fingerprint: 'b'.repeat(64) });
  assert.equal(f.rooms.cacheReady(f.room), false);
  f.rooms.act(f.room, f.second, ready);
  assert.equal(f.rooms.cacheReady(f.room), true);
  f.rooms.act(f.room, f.first, {
    type: 'control',
    op: 'p2',
    base: f.room.revision,
    action: 'play',
  });
  assert.equal(f.room.playback.paused, false);
  f.rooms.disconnect(f.room, f.second, f.b);
  assert.equal(f.room.playback.paused, true);
  assert.equal(f.rooms.cacheReady(f.room), false);
});
test('缓存：加入新成员关闭门槛；恢复身份不恢复缓存 ready；自然结束须全员确认', () => {
  const f = fixture();
  f.rooms.act(f.room, f.first, { type: 'media', op: 'm', base: 0, media: direct });
  f.rooms.act(f.room, f.first, { type: 'mode', op: 'm2', base: f.room.revision, mode: 'cache' });
  const ready = {
    type: 'cache' as const,
    epoch: f.room.epoch,
    mediaId: f.room.media!.id,
    state: 'ready' as const,
    progress: 1,
    bytes: 1000,
    fingerprint: 'a'.repeat(64),
  };
  f.rooms.act(f.room, f.first, ready);
  f.rooms.act(f.room, f.second, ready);
  const c = socket(),
    { seat } = f.rooms.join(`${f.room.code}:${f.room.token}`, '丙', c);
  assert.equal(f.rooms.cacheReady(f.room), false);
  f.rooms.disconnect(f.room, seat, c, true);
  assert.equal(f.rooms.cacheReady(f.room), true);
  const resume = f.second.resume;
  f.rooms.disconnect(f.room, f.second, f.b);
  const newSocket = socket();
  const restored = f.rooms.join(`${f.room.code}:${f.room.token}`, '乙', newSocket, resume);
  assert.equal(restored.seat.id, f.second.id);
  assert.equal(restored.seat.cache.state, 'idle');
  const ended = {
    type: 'ended' as const,
    mediaId: f.room.media!.id,
    epoch: f.room.epoch,
    position: 120,
    duration: 120,
  };
  f.rooms.act(f.room, f.first, { ...ended, position: 2 });
  assert.equal(f.first.ended, false);
  f.rooms.act(f.room, f.first, ended);
  assert.equal(f.room.cleaned, false);
  f.rooms.act(f.room, restored.seat, ended);
  assert.equal(f.room.cleaned, true);
  assert.ok((f.a as unknown as Socket).messages.some((m) => m.type === 'cleanup'));
});
test('邀请鉴权、断线清理和空房间过期', () => {
  const f = fixture();
  assert.throws(() => f.rooms.join(`${f.room.code}:${'x'.repeat(32)}`, '陌生人', socket()), /邀请/);
  f.rooms.disconnect(f.room, f.first, f.a);
  f.rooms.disconnect(f.room, f.second, f.b);
  f.advance(31000);
  f.rooms.sweep();
  assert.equal(f.room.members.size, 0);
  f.advance(900001);
  f.rooms.sweep();
  assert.equal(f.rooms.rooms.size, 0);
});
test('未看完成员离开后，已经看完的剩余成员仍能触发清理', () => {
  const f = fixture();
  f.rooms.act(f.room, f.first, { type: 'media', op: 'm', base: 0, media: direct });
  f.rooms.act(f.room, f.first, {
    type: 'ended',
    mediaId: f.room.media!.id,
    epoch: f.room.epoch,
    position: 120,
    duration: 120,
  });
  assert.equal(f.room.cleaned, false);
  f.rooms.disconnect(f.room, f.second, f.b, true);
  assert.equal(f.room.cleaned, true);
});
test('聊天历史有数量和字节限制，文本作为数据保存', () => {
  const f = fixture();
  for (let i = 0; i < 110; i++)
    f.rooms.act(f.room, f.first, { type: 'chat', text: `<img src=x onerror=alert(1)> ${i}` });
  assert.equal(f.room.chat.length, 100);
  assert.ok(f.room.chat[0]!.text!.endsWith('10'));
  assert.ok(f.room.chatBytes < 2 * 1024 ** 2);
});
test('播放纠偏有追赶滞回，显式拖动立即跟随，单调推算不倒退', () => {
  assert.equal(reconcile(10, 10.2, 1, false).kind, 'ignore');
  assert.equal(reconcile(10, 10.5, 1, false).kind, 'rate');
  assert.equal(reconcile(10, 10.2, 1, false, false, true).kind, 'rate');
  assert.equal(reconcile(10, 12, 1, false).kind, 'seek');
  assert.equal(reconcile(10, 10.01, 1, false, true).kind, 'seek');
  assert.equal(positionAt(10, false, 2, 1000), 12);
  assert.equal(positionAt(10, false, 1, -1000), 10);
});
test('来源识别保留 B 站分 P 并移除跟踪信息，协议拒绝恶意数值和地址', () => {
  assert.equal(
    describeUrl('https://www.bilibili.com/video/BV1KQp565ENm/?p=2&vd_source=tracking').url,
    'https://www.bilibili.com/video/BV1KQp565ENm/?p=2',
  );
  assert.throws(() => describeUrl('javascript:alert(1)'));
  assert.throws(() => describeUrl('https://user:password@example.com/'));
  assert.ok(
    !clientMessageSchema.safeParse({
      type: 'control',
      base: 0,
      op: 'x',
      action: 'seek',
      position: NaN,
    }).success,
  );
  assert.ok(parseInvite('https://room.example/#ABC234:' + 'a'.repeat(32)));
  assert.equal(parseInvite('ABC234'), null);
});
