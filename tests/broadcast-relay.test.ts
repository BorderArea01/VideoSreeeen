import test from 'node:test';
import assert from 'node:assert/strict';
import { BroadcastRelay, type RelaySocket } from '../server/broadcast-relay';
import { Rooms, type RoomSocket } from '../server/rooms';
import { RELAY_MIMES, RELAY_PACKET, RELAY_WINDOW, relayPacket } from '../shared/broadcast-relay';

class Socket implements RelaySocket {
  readyState = 1;
  bufferedAmount = 0;
  messages: Array<any> = [];
  send(raw: string | Uint8Array) {
    this.messages.push(typeof raw === 'string' ? JSON.parse(raw) : raw.slice());
  }
  close() {
    this.readyState = 3;
  }
}
const session = '1234567890abcdef1234567890abcdef';
function fixture() {
  let now = 1000;
  const rooms = new Rooms(() => now),
    hub = new BroadcastRelay(rooms, () => now);
  const { room, seat: host } = rooms.create('host', new Socket() as RoomSocket);
  const { seat: viewer } = rooms.join(
    `${room.code}:${room.token}`,
    'viewer',
    new Socket() as RoomSocket,
  );
  rooms.act(room, host, {
    type: 'media',
    base: room.revision,
    op: 'start',
    media: {
      url: 'https://example.com/screen',
      title: 'screen',
      provider: 'local',
      broadcast: { host: host.id, kind: 'screen' },
    },
  });
  function connect(seat: typeof host) {
    const socket = new Socket();
    hub.connect(socket);
    const auth = {
      type: 'hello' as const,
      code: room.code,
      member: seat.id,
      secret: seat.resume,
      media: room.media!.id,
      epoch: room.epoch,
      formats: [...RELAY_MIMES],
    };
    hub.message(socket, JSON.stringify(auth));
    return { socket, auth };
  }
  const publish = connect(host),
    receive = connect(viewer);
  const start = () =>
    hub.message(publish.socket, JSON.stringify({ type: 'start', session, mime: RELAY_MIMES[0] }));
  return {
    rooms,
    hub,
    room,
    host,
    viewer,
    connect,
    publish,
    receive,
    start,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('备用视频通道只向同媒体授权观众转发，房间信令不携带媒体', () => {
  const f = fixture();
  assert.equal(f.publish.socket.messages.at(-1).type, 'need');
  f.start();
  const packet = relayPacket(session, 0, new Uint8Array([1, 2, 3]));
  f.hub.message(f.publish.socket, packet);
  assert.deepEqual(f.receive.socket.messages.at(-1), packet);
  assert.equal(f.room.chat.length, 0);
  f.hub.message(f.receive.socket, JSON.stringify({ type: 'ack', session, sequence: 0 }));
  const intruder = new Socket();
  f.hub.connect(intruder);
  f.hub.message(intruder, JSON.stringify({ ...f.receive.auth, secret: 'invalid' }));
  assert.equal(intruder.readyState, 3);
  f.hub.message(f.receive.socket, relayPacket(session, 1, new Uint8Array([3])));
  assert.equal(f.receive.socket.readyState, 3, 'Viewers cannot publish');
});

test('慢观众超过确认窗口被单独关闭，健康观众继续接收', () => {
  const f = fixture();
  const { seat } = f.rooms.join(
    `${f.room.code}:${f.room.token}`,
    'healthy',
    new Socket() as RoomSocket,
  );
  const healthy = f.connect(seat);
  f.start();
  for (let sequence = 0; sequence <= RELAY_WINDOW / (RELAY_PACKET + 20); sequence++) {
    f.advance(300);
    f.hub.message(f.publish.socket, relayPacket(session, sequence, new Uint8Array(RELAY_PACKET)));
    f.hub.message(healthy.socket, JSON.stringify({ type: 'ack', session, sequence }));
  }
  assert.equal(f.receive.socket.readyState, 3);
  assert.equal(healthy.socket.readyState, 1);
  assert.ok(healthy.socket.messages.at(-1) instanceof Uint8Array);
});

test('停止共享或成员离开立即使备用传输授权失效', () => {
  const f = fixture();
  f.start();
  f.rooms.act(f.room, f.host, { type: 'unshare', base: f.room.revision, op: 'stop' });
  f.hub.sweep();
  assert.equal(f.receive.socket.readyState, 3);
  assert.equal(f.publish.socket.readyState, 3);
});

test('旧编码代次不污染新流，丢帧和未认证二进制拒绝', () => {
  const f = fixture();
  f.start();
  const replacement = 'abcdef1234567890abcdef1234567890';
  f.hub.message(
    f.publish.socket,
    JSON.stringify({ type: 'start', session: replacement, mime: RELAY_MIMES[0] }),
  );
  const before = f.receive.socket.messages.length;
  f.hub.message(f.publish.socket, relayPacket(session, 0, new Uint8Array([1])));
  assert.equal(f.receive.socket.messages.length, before);
  f.hub.message(f.publish.socket, relayPacket(replacement, 2, new Uint8Array([1])));
  assert.equal(f.publish.socket.readyState, 3);
  const intruder = new Socket();
  f.hub.connect(intruder);
  f.hub.message(intruder, relayPacket(session, 0, new Uint8Array([1])));
  assert.equal(intruder.readyState, 3);
});

test('休眠恢复仅恢复授权，要求重新编码而不重放旧媒体', () => {
  const f = fixture();
  f.start();
  const fresh = new BroadcastRelay(f.rooms);
  fresh.connect(f.publish.socket, f.publish.auth);
  fresh.connect(f.receive.socket, f.receive.auth);
  fresh.restored();
  assert.deepEqual(f.publish.socket.messages.at(-1), { type: 'need', formats: [[...RELAY_MIMES]] });
  const before = f.receive.socket.messages.length;
  fresh.message(f.publish.socket, relayPacket(session, 0, new Uint8Array([1])));
  assert.equal(f.receive.socket.messages.length, before);
});
