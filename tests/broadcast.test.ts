import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { BroadcastPeers } from '../client/broadcast';
import type { ClientMessage, ServerMessage, Snapshot } from '../shared/protocol';

type Signal = Extract<ServerMessage, { type: 'signal' }>;
class Peer {
  static instances: Peer[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: unknown;
  onicecandidateerror: ((event: { errorCode: number }) => void) | null = null;
  ontrack: unknown;
  offers: RTCOfferOptions[] = [];
  closed = false;
  stats = new Map<string, Record<string, unknown>>();
  constructor() {
    Peer.instances.push(this);
  }
  addTrack() {
    return { getParameters: () => ({}) };
  }
  getSenders() {
    return [];
  }
  async createOffer(options: RTCOfferOptions) {
    this.offers.push(options);
    return { type: 'offer' as const, sdp: `offer-${Peer.instances.indexOf(this)}` };
  }
  async createAnswer() {
    return { type: 'answer' as const, sdp: 'answer' };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate() {}
  async getStats() {
    return this.stats;
  }
  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }
  state(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}
function setup(t: TestContext, me = 'host') {
  Peer.instances = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'RTCPeerConnection');
  Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: Peer });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'RTCPeerConnection', original);
    else Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
  });
  const room = {
    mode: 'stream',
    epoch: 1,
    media: {
      id: 'video',
      url: 'https://example.com/stream',
      broadcast: { host: 'host', kind: 'screen' },
    },
    members: [
      { id: 'host', online: true },
      { id: 'viewer', online: true },
    ],
  } as unknown as Snapshot;
  const sent: ClientMessage[] = [];
  const received: (MediaStream | null)[] = [];
  const peers = new BroadcastPeers(
    (message) => {
      sent.push(message);
      return true;
    },
    (stream) => received.push(stream),
    () => {},
  );
  const stream = {
    active: true,
    getTracks: () => [],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
  if (me === 'host') peers.publish(stream, room.media!.url);
  peers.configure(room, me);
  const signal = (from: string, type: 'offer' | 'answer'): Signal => ({
    type: 'signal',
    purpose: 'broadcast',
    from,
    mediaId: room.media!.id,
    epoch: room.epoch,
    data: { kind: 'description', type, sdp: type },
  });
  return { peers, room, sent, received, signal };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('连接诊断保留协商及媒体计数，不导出地址、SDP或中继凭证', async (t) => {
  const f = setup(t, 'viewer');
  f.peers.setIceServers([
    { urls: 'turns:example.com', username: 'private-user', credential: 'private-key' },
  ]);
  f.peers.receive(f.signal('host', 'offer'));
  await flush();
  const pc = Peer.instances[0]!;
  pc.remoteDescription = { type: 'offer', sdp: 'private-sdp' };
  pc.onicecandidateerror?.({ errorCode: 701 });
  pc.stats = new Map([
    [
      'local',
      {
        type: 'local-candidate',
        candidateType: 'srflx',
        address: '192.0.2.10',
        port: 4444,
        protocol: 'udp',
      },
    ],
    [
      'remote',
      { type: 'remote-candidate', candidateType: 'host', address: '198.51.100.10', port: 5555 },
    ],
    [
      'pair',
      {
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
        currentRoundTripTime: 0.123,
      },
    ],
    ['rtp', { type: 'inbound-rtp', kind: 'video', bytesReceived: 1000, framesDecoded: 7 }],
  ]);
  const result = await f.peers.diagnostics();
  assert.equal(result.role, 'viewer');
  assert.equal(result.hasTurn, true);
  assert.deepEqual(result.connections[0]!.localCandidates, { srflx: 1 });
  assert.equal(result.connections[0]!.selectedPair?.roundTripMs, 123);
  assert.equal(result.connections[0]!.media[0]!.framesDecoded, 7);
  assert.deepEqual(result.connections[0]!.iceErrorCodes, [701]);
  assert.doesNotMatch(JSON.stringify(result), /192\.0\.2\.10|198\.51\.100\.10|4444|5555|private-/);
  f.peers.release();
});

test('画面连接断开后提供方真正发送 ICE restart，保留连接并执行退避', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const f = setup(t);
  await flush();
  const pc = Peer.instances[0]!;
  f.peers.receive(f.signal('viewer', 'answer'));
  await flush();
  pc.state('connected');
  pc.state('disconnected');
  f.peers.configure(f.room, 'host');
  await flush();
  assert.equal(pc.offers.length, 1, 'No immediate retry storm');
  now += 10001;
  f.peers.configure(f.room, 'host');
  await flush();
  assert.deepEqual(pc.offers, [{ iceRestart: false }, { iceRestart: true }]);
  assert.equal(Peer.instances.length, 1);
  assert.equal(pc.closed, false);
  assert.equal(f.sent.filter((message) => message.type === 'signal').length, 2);
  f.peers.release();
  assert.equal(pc.closed, true);
});

test('接收失败保持协商通道；新 offer 可恢复，离线和中继状态真实可查', async (t) => {
  const f = setup(t, 'viewer');
  assert.deepEqual(f.peers.reception(), { state: 'waiting', hasTurn: false });
  f.peers.receive(f.signal('host', 'offer'));
  await flush();
  const pc = Peer.instances[0]!;
  const clears = f.received.length;
  pc.state('failed');
  assert.equal(f.peers.reception().state, 'failed');
  assert.equal(pc.closed, false);
  assert.equal(f.received.length, clears, 'A temporary failure must not discard the stream');
  f.peers.receive(f.signal('host', 'offer'));
  await flush();
  pc.state('connected');
  assert.equal(f.peers.reception().state, 'connected');
  f.peers.setIceServers([
    { urls: ['stun:example.com', 'turns:example.com'], username: 'u', credential: 'p' },
  ]);
  assert.equal(f.peers.reception().hasTurn, true);
  f.peers.configure(
    {
      ...f.room,
      members: f.room.members.map((member) => ({ ...member, online: member.id !== 'host' })),
    },
    'viewer',
  );
  assert.equal(f.peers.reception().state, 'offline');
  f.peers.release();
});

test('换片取消尚未执行的旧协商，旧 SDP 不得带新媒体标识发出', async (t) => {
  const f = setup(t);
  f.peers.configure({ ...f.room, epoch: 2 }, 'host');
  await flush();
  const signals = f.sent.filter((message) => message.type === 'signal');
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.epoch, 2);
  assert.deepEqual(Peer.instances[0]!.offers, []);
  assert.equal(Peer.instances[0]!.closed, true);
  f.peers.release();
});
