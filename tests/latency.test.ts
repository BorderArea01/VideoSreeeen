import test from 'node:test';
import assert from 'node:assert/strict';
import { startProbe, finishProbe, RTT_TTL, type ProbeState } from '../server/latency';
import { Rooms } from '../server/rooms';
import { Latencies } from '../client/latency';

test('RTT 使用一次性服务器挑战，拒绝伪造、重放、过期与探测洪泛', () => {
  const state: ProbeState = {};
  const nonce = startProbe(state, 0)!;
  assert.ok(nonce);
  assert.equal(startProbe(state, 100), null);
  assert.equal(finishProbe(state, 'forged', 100), null);
  assert.equal(finishProbe(state, nonce, 243), 243);
  assert.equal(finishProbe(state, nonce, 250), null);
  assert.equal(startProbe(state, 4999), null);
  const next = startProbe(state, 5000)!;
  assert.equal(finishProbe(state, next, 5000 + RTT_TTL), null);
});

test('全员收到同一 RTT 样本；延迟广播不修改播放版本，旧连接不能写入', () => {
  let now = 1000;
  const rooms = new Rooms(() => now);
  const makeSocket = () => ({
    readyState: 1,
    messages: [] as any[],
    send(raw: string) {
      this.messages.push(JSON.parse(raw));
    },
    close() {},
  });
  const a = makeSocket(),
    b = makeSocket();
  const { room, seat } = rooms.create('A', a);
  seat.latencyEvents = true;
  rooms.join(room.code + ':' + room.token, 'B', b).seat.latencyEvents = true;
  const legacy = makeSocket();
  rooms.join(room.code + ':' + room.token, 'old', legacy);
  const revision = room.revision,
    playback = { ...room.playback };
  now += 50;
  assert.deepEqual(rooms.clock(room), {
    mediaId: null,
    epoch: room.epoch,
    revision: room.playback.revision,
    ageMs: 50,
  });
  rooms.recordLatency(room, seat, a, 243);
  assert.deepEqual(a.messages.at(-1), b.messages.at(-1));
  assert.equal(a.messages.at(-1).type, 'latency');
  assert.equal(legacy.messages.at(-1).type, 'state');
  assert.equal(legacy.messages.at(-1).room.members[0].rtt, 243);
  assert.equal(a.messages.at(-1).members[0].rtt, 243);
  assert.equal(rooms.snapshot(room).members[0].rttAgeMs, 0);
  rooms.recordLatency(room, seat, b, 999);
  assert.equal(seat.rtt, 243);
  assert.equal(room.revision, revision);
  assert.deepEqual(room.playback, playback);
  now += RTT_TTL;
  assert.equal(rooms.snapshot(room).members[0].rtt, null);
});

test('各端使用服务端样本与相对年龄，过期不显示旧数字，无样本不编造', () => {
  const a = new Latencies(),
    b = new Latencies();
  a.update([{ id: 'A', rtt: 243, rttAgeMs: 100 }], 2000);
  b.update([{ id: 'A', rtt: 243, rttAgeMs: 100 }], 9000);
  assert.equal(a.read('A', 2500).label, b.read('A', 9500).label);
  assert.equal(a.read('A', 2500).label, '243 ms');
  assert.equal(a.read('A', 2000 + RTT_TTL).label, '—');
  a.update([{ id: 'A', rtt: null }], 20000);
  assert.equal(a.read('A', 20000).label, '—');
  assert.equal(a.read('missing', 20000).rtt, null);
  a.update([{ id: 'A', rtt: 0, rttAgeMs: 0 }], 20000);
  assert.equal(a.read('A', 20000).label, '<1 ms');
  a.clear();
  assert.equal(a.read('A', 20000).label, '—');
});
