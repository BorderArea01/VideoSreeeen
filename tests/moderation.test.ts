import assert from 'node:assert/strict';
import test from 'node:test';
import { Rooms } from '../server/rooms';

class Socket {
  readyState = 1;
  messages: any[] = [];
  code = 0;
  send(data: string) {
    this.messages.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.code = code;
    this.readyState = 3;
  }
}
function fixture(count = 3) {
  let now = 1000;
  const rooms = new Rooms(() => now),
    socket = new Socket(),
    { room, seat } = rooms.create('A', socket);
  const seats = [seat],
    sockets = [socket];
  for (let i = 1; i < count; i++) {
    const socket = new Socket();
    sockets.push(socket);
    seats.push(rooms.join(`${room.code}:${room.token}`, String(i), socket).seat);
  }
  return {
    rooms,
    room,
    seats,
    sockets,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test('票选踢人使用严格多数：两人不能单方面移出，重复票不累加，不能投票移出自己', () => {
  const f = fixture(2);
  assert.throws(
    () =>
      f.rooms.act(f.room, f.seats[0]!, {
        type: 'kick-vote',
        action: 'start',
        target: f.seats[1]!.id,
      }),
    /至少 3/,
  );
  const third = f.rooms.join(`${f.room.code}:${f.room.token}`, 'C', new Socket()).seat;
  const first = f.seats[0]!;
  f.rooms.act(f.room, first, { type: 'kick-vote', action: 'start', target: third.id });
  const voteId = f.room.kickVote!.id;
  f.rooms.act(f.room, first, { type: 'kick-vote', action: 'yes', voteId });
  assert.equal(f.room.kickVote!.yes.length, 1);
  assert.throws(
    () => f.rooms.act(f.room, third, { type: 'kick-vote', action: 'yes', voteId }),
    /自己/,
  );
  assert.equal(f.rooms.snapshot(f.room).kickVote!.required, 2);
});
test('多数通过使目标房间凭据失效，断开所有房间权限；不改变普通影片的时间线', () => {
  const f = fixture(),
    [a, b, target] = f.seats;
  const playback = { ...f.room.playback };
  f.rooms.act(f.room, a!, { type: 'kick-vote', action: 'start', target: target!.id });
  const voteId = f.room.kickVote!.id;
  f.rooms.act(f.room, b!, { type: 'kick-vote', action: 'yes', voteId });
  assert.equal(f.room.members.has(target!.id), false);
  assert.equal(f.sockets[2]!.code, 4004);
  assert.equal(f.rooms.memberAccess(f.room.code, target!.id, target!.resume), null);
  assert.throws(
    () => f.rooms.join(`${f.room.code}:${f.room.token}`, 'return', new Socket(), target!.resume),
    /已被.*移出/,
  );
  assert.deepEqual(f.room.playback, playback);
  const restoredRooms = new Rooms();
  const restored = restoredRooms.restore(f.rooms.dump(f.room));
  assert.throws(
    () =>
      restoredRooms.join(
        `${restored.code}:${restored.token}`,
        'return after restore',
        new Socket(),
        target!.resume,
      ),
    /已被.*移出/,
  );
  assert.ok(!JSON.stringify(f.rooms.snapshot(f.room)).includes(target!.resume));
  assert.throws(
    () => f.rooms.act(f.room, target!, { type: 'kick-vote', action: 'start', target: a!.id }),
    /重新加入/,
  );
});
test('票选反对、超时、在线名单变化与恢复均正确失效；旧投票不能作用于新投票', () => {
  const f = fixture(),
    [a, b, target] = f.seats;
  const start = () =>
    f.rooms.act(f.room, a!, { type: 'kick-vote', action: 'start', target: target!.id });
  start();
  const old = f.room.kickVote!.id;
  f.rooms.act(f.room, b!, { type: 'kick-vote', action: 'no', voteId: old });
  f.rooms.act(f.room, target!, { type: 'kick-vote', action: 'no', voteId: old });
  assert.equal(f.room.kickVote, undefined);
  assert.equal(f.room.members.size, 3);
  assert.throws(start, /冷却/);
  f.advance(30001);
  start();
  f.advance(60001);
  f.rooms.sweep();
  assert.equal(f.room.kickVote, undefined);
  f.advance(30001);
  start();
  f.rooms.join(`${f.room.code}:${f.room.token}`, 'new', new Socket());
  assert.equal(f.room.kickVote, undefined);
  assert.throws(
    () => f.rooms.act(f.room, b!, { type: 'kick-vote', action: 'yes', voteId: old }),
    /失效/,
  );
  f.advance(30001);
  start();
  const stored = f.rooms.dump(f.room);
  const restored = new Rooms().restore(stored);
  assert.equal(restored.kickVote, undefined);
});
