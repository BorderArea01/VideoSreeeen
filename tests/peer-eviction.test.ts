import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomPeers } from '../client/peers';
import { BLOCK_SIZE } from '../shared/cache-plan';

test('删除块撤回成员库存、终止过期请求，重发清单不再宣告已删数据；错代清单不生效', async () => {
  const sender = new RoomPeers(() => true),
    receiver = new RoomPeers(() => true);
  const files = [{ name: 'video.mp4', size: 3 * BLOCK_SIZE }];
  await sender.start(files, async () => new Uint8Array(BLOCK_SIZE));
  await receiver.start(files, async () => new Uint8Array(BLOCK_SIZE));
  const wire: any[] = [],
    key = (sender as any).planKey;
  const peer: any = {
    channel: {
      readyState: 'open',
      bufferedAmount: 0,
      send: (s: string) => wire.push(JSON.parse(s)),
    },
    have: new Map(),
    sending: Promise.resolve(),
    key,
  };
  (sender as any).peers.set('fixture', peer);
  sender.announce(0, 0, 'a'.repeat(64));
  sender.announce(0, BLOCK_SIZE, 'b'.repeat(64));
  const remote: any = {
    have: new Map([
      ['0:0', 'a'.repeat(64)],
      [`0:${BLOCK_SIZE}`, 'b'.repeat(64)],
    ]),
    key,
  };
  let cancelled = false;
  remote.pending = {
    file: 0,
    offset: 0,
    timer: setTimeout(() => {}, 10000),
    resolve: (value: unknown) => {
      assert.equal(value, null);
      cancelled = true;
    },
  };
  sender.forget(0, [0]);
  await peer.sending;
  const drop = wire.find((m) => m.type === 'drop');
  assert.ok(drop);
  assert.equal(drop.blocks.length, 1);
  (receiver as any).message(remote, { ...drop, key: 'c'.repeat(64) });
  assert.equal(remote.have.size, 2);
  assert.equal(cancelled, false);
  (receiver as any).message(remote, drop);
  assert.equal(cancelled, true);
  assert.equal(remote.have.has('0:0'), false);
  assert.equal(remote.have.has(`0:${BLOCK_SIZE}`), true);
  wire.length = 0;
  (sender as any).hello(peer);
  await peer.sending;
  assert.ok(
    wire
      .filter((m) => m.type === 'have')
      .flatMap((m) => m.blocks)
      .every((b) => b.offset !== 0),
  );
});
