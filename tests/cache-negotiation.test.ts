import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomPeers } from '../client/peers';
import { Rooms } from '../server/rooms';

test('缓存换代后，旧 offer 与 ICE 回调不能冒用新代次发送', async () => {
  const connections: MockPC[] = [];
  class MockPC {
    onicecandidate?: (event: any) => void;
    ondatachannel?: unknown;
    onconnectionstatechange?: unknown;
    connectionState = 'new';
    constructor() {
      connections.push(this);
    }
    createOffer() {
      return Promise.resolve({ type: 'offer', sdp: 'test' });
    }
    setLocalDescription() {
      return Promise.resolve();
    }
    createDataChannel() {
      return { readyState: 'connecting', close() {} };
    }
    close() {
      this.connectionState = 'closed';
    }
  }
  const previous = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = MockPC as unknown as typeof RTCPeerConnection;
  const makeSocket = () => ({ readyState: 1, send() {}, close() {} });
  const rooms = new Rooms(),
    a = makeSocket(),
    b = makeSocket();
  const { room, seat } = rooms.create('A', a);
  rooms.join(room.code + ':' + room.token, 'B', b);
  rooms.act(room, seat, {
    type: 'media',
    op: 'm',
    base: room.revision,
    media: {
      url: 'https://example.com/video.mp4',
      title: 'test',
      provider: 'direct',
      source: { kind: 'file', video: 'https://example.com/video.mp4' },
    },
  });
  rooms.act(room, seat, { type: 'mode', op: 'c', base: room.revision, mode: 'cache' });
  const snapshot = rooms.snapshot(room),
    me = snapshot.members.map((m) => m.id).sort()[0];
  const sent: any[] = [];
  const peers = new RoomPeers((message) => {
    sent.push(message);
    return true;
  });
  try {
    peers.setIceServers([], true);
    peers.configure(snapshot, me);
    const oldCandidate = connections[0].onicecandidate!;
    peers.configure({ ...snapshot, epoch: snapshot.epoch + 1 }, me);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].epoch, snapshot.epoch + 1);
    const candidate = { candidate: { candidate: 'test', sdpMid: null, sdpMLineIndex: null } };
    oldCandidate(candidate);
    assert.equal(sent.length, 1);
    connections[1].onicecandidate!(candidate);
    assert.equal(sent.length, 2);
  } finally {
    peers.close();
    globalThis.RTCPeerConnection = previous;
  }
});
