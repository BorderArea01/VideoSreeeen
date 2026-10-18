import type { ClientMessage, ServerMessage, Snapshot } from '../shared/protocol';

type Signal = Extract<ServerMessage, { type: 'signal' }>;
interface Connection {
  pc: RTCPeerConnection;
  candidates: RTCIceCandidateInit[];
  work: Promise<void>;
  scope: string;
  offering: boolean;
  iceErrors: Set<number>;
}

/** One explicitly selected publisher; media never passes through the room server. */
export class BroadcastPeers {
  private connections = new Map<string, Connection>();
  private room: Snapshot | null = null;
  private me = '';
  private scope = '';
  private ice: RTCIceServer[] = [];
  private local: MediaStream | null = null;
  private localUrl = '';
  private retry = new Map<string, number>();
  private incoming: MediaStream | null = null;
  private enabled = true;
  receivedStream() {
    return this.incoming;
  }
  constructor(
    private send: (message: ClientMessage) => boolean,
    private receiveStream: (stream: MediaStream | null) => void,
    private status: (text: string) => void,
  ) {}
  setIceServers(ice: RTCIceServer[]) {
    this.ice = ice;
  }
  publish(stream: MediaStream, url: string) {
    this.release();
    this.local = stream;
    this.localUrl = url;
    for (const track of stream.getVideoTracks()) track.contentHint = 'detail';
  }
  owns(url: string) {
    return !!this.local?.active && this.localUrl === url;
  }
  viewers() {
    const viewers = this.room?.members.filter((m) => m.online && m.id !== this.me) ?? [];
    const expected = viewers.length;
    const connected = [...this.connections.values()].filter(
      (connection) => connection.pc.connectionState === 'connected',
    ).length;
    const failed = viewers.filter((member) => this.retry.has(member.id)).length;
    return { expected, connected, failed };
  }
  reception() {
    const host = this.room?.media?.broadcast?.host;
    const pc = host ? this.connections.get(host)?.pc : undefined;
    const offline =
      !!host && !this.room?.members.some((member) => member.id === host && member.online);
    const hasTurn = this.ice.some((server) =>
      (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) =>
        /^turns?:/i.test(url),
      ),
    );
    return { state: offline ? 'offline' : (pc?.connectionState ?? 'waiting'), hasTurn };
  }
  async diagnostics() {
    const connections = [];
    for (const [id, c] of this.connections) {
      const pc = c.pc;
      let report: RTCStatsReport | undefined;
      try {
        report = await pc.getStats();
      } catch {
        /* A closing transport may have no report. */
      }
      if (!this.current(id, c)) continue;
      const stats = report ? [...report.values()] : [];
      const types = (type: string) => {
        const counts: Record<string, number> = {};
        for (const stat of stats.filter((stat) => stat.type === type)) {
          const kind = String(stat.candidateType ?? 'unknown');
          counts[kind] = (counts[kind] ?? 0) + 1;
        }
        return counts;
      };
      const transport = stats.find(
        (stat) => stat.type === 'transport' && stat.selectedCandidatePairId,
      );
      const pair = transport
        ? report?.get(transport.selectedCandidatePairId)
        : stats.find(
            (stat) =>
              stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded',
          );
      const local = pair && report?.get(pair.localCandidateId);
      const remote = pair && report?.get(pair.remoteCandidateId);
      connections.push({
        connection: pc.connectionState,
        ice: pc.iceConnectionState,
        gathering: pc.iceGatheringState,
        signaling: pc.signalingState,
        localDescription: pc.localDescription?.type ?? null,
        remoteDescription: pc.remoteDescription?.type ?? null,
        iceErrorCodes: [...c.iceErrors],
        localCandidates: types('local-candidate'),
        remoteCandidates: types('remote-candidate'),
        selectedPair: pair
          ? {
              state: pair.state,
              localType: local?.candidateType,
              remoteType: remote?.candidateType,
              protocol: local?.protocol,
              roundTripMs:
                typeof pair.currentRoundTripTime === 'number'
                  ? Math.round(pair.currentRoundTripTime * 1000)
                  : undefined,
            }
          : null,
        media: stats
          .filter((stat) => ['inbound-rtp', 'outbound-rtp'].includes(stat.type))
          .map((stat) => ({
            direction: stat.type,
            kind: stat.kind,
            bytesReceived: stat.bytesReceived,
            bytesSent: stat.bytesSent,
            framesDecoded: stat.framesDecoded,
            framesEncoded: stat.framesEncoded,
          })),
      });
    }
    return {
      role: this.room?.media?.broadcast?.host === this.me ? 'publisher' : 'viewer',
      hasTurn: this.reception().hasTurn,
      connections,
    };
  }
  configure(room: Snapshot | null, me: string, enabled = true) {
    this.enabled = enabled;
    const broadcast = room?.mode === 'stream' && room.media?.broadcast;
    const scope = broadcast ? `${room!.media!.id}:${room!.epoch}` : '';
    if (scope !== this.scope || me !== this.me) {
      this.close();
      this.scope = scope;
      this.me = me;
    }
    this.room = room;
    if (!enabled) {
      for (const connection of this.connections.values()) connection.pc.close();
      this.connections.clear();
      this.retry.clear();
      return;
    }
    if (!broadcast || !scope) return;
    const host = broadcast.host;
    const online = room!.members
      .filter((m) => m.online && m.id !== me && (me === host || m.id === host))
      .map((m) => m.id);
    for (const [id, c] of this.connections)
      if (!online.includes(id)) {
        c.pc.close();
        this.connections.delete(id);
      }
    if (!room!.members.some((m) => m.id === host && m.online)) {
      this.receiveStream(null);
      this.status('视频提供者已离线');
      return;
    }
    if (me !== host) return;
    if (!this.owns(room!.media!.url)) {
      this.status('请选择视频文件或重新开始共享');
      return;
    }
    for (const id of online) {
      const existing = this.connections.get(id);
      if (existing) {
        if (
          (this.retry.has(id) ||
            ['failed', 'disconnected'].includes(existing.pc.connectionState)) &&
          Date.now() >= (this.retry.get(id) ?? 0)
        ) {
          this.retry.set(id, Date.now() + 10000);
          this.offer(id, existing, true);
        }
      } else if (Date.now() >= (this.retry.get(id) ?? 0)) {
        const c = this.create(id);
        for (const track of this.local!.getTracks()) {
          const sender = c.pc.addTrack(track, this.local!);
          if (track.kind === 'video') {
            const params = sender.getParameters();
            if (params.encodings?.length) {
              params.encodings[0].maxBitrate = 6_000_000;
              void sender.setParameters(params).catch(() => {});
            }
          }
        }
        this.offer(id, c);
      }
    }
  }
  private current(id: string, c: Connection) {
    return this.connections.get(id) === c && this.scope === c.scope;
  }
  private offer(id: string, c: Connection, restart = false) {
    if (c.offering) return;
    c.offering = true;
    c.work = c.work
      .then(async () => {
        if (!this.current(id, c)) return;
        if (restart && c.pc.signalingState === 'have-local-offer' && c.pc.localDescription?.sdp) {
          this.signal(id, { kind: 'description', type: 'offer', sdp: c.pc.localDescription.sdp });
          return;
        }
        if (c.pc.signalingState !== 'stable') return;
        const offer = await c.pc.createOffer({ iceRestart: restart });
        if (!this.current(id, c)) return;
        await c.pc.setLocalDescription(offer);
        for (const sender of c.pc.getSenders())
          if (sender.track?.kind === 'video') {
            const parameters = sender.getParameters();
            parameters.degradationPreference = 'maintain-resolution';
            for (const encoding of parameters.encodings ?? []) {
              encoding.maxBitrate = 6_000_000;
              encoding.maxFramerate = 30;
              const size = sender.track.getSettings();
              encoding.scaleResolutionDownBy = Math.max(
                1,
                (size.width ?? 1920) / 1920,
                (size.height ?? 1080) / 1080,
              );
            }
            await sender.setParameters(parameters).catch(() => {});
          }
        if (this.current(id, c))
          this.signal(id, { kind: 'description', type: 'offer', sdp: offer.sdp! });
      })
      .catch(() => this.failed(id, c))
      .finally(() => {
        c.offering = false;
      });
  }
  private signal(to: string, data: Signal['data']) {
    if (this.room?.media && this.scope)
      this.send({
        type: 'signal',
        purpose: 'broadcast',
        to,
        mediaId: this.room.media.id,
        epoch: this.room.epoch,
        data,
      });
  }
  private create(id: string) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const c: Connection = {
      pc,
      candidates: [],
      work: Promise.resolve(),
      scope: this.scope,
      offering: false,
      iceErrors: new Set(),
    };
    this.connections.set(id, c);
    pc.onicecandidateerror = (event) => {
      if (this.current(id, c)) c.iceErrors.add(event.errorCode);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && this.current(id, c))
        this.signal(id, {
          kind: 'candidate',
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        });
    };
    pc.ontrack = (e) => {
      if (this.current(id, c) && this.room?.media?.broadcast?.host === id) {
        const stream = e.streams[0];
        if (stream) {
          this.incoming = stream;
          this.receiveStream(stream);
        }
      }
    };
    pc.onconnectionstatechange = () => {
      if (!this.current(id, c)) return;
      if (pc.connectionState === 'failed') this.failed(id, c);
      else if (pc.connectionState === 'connected') {
        this.retry.delete(id);
        this.status('实时画面已连接');
      } else if (pc.connectionState === 'disconnected') {
        this.retry.set(id, Date.now() + 10000);
        this.status('画面连接中断，正在重连');
      }
    };
    return c;
  }
  private failed(id: string, c: Connection) {
    if (!this.current(id, c)) return;
    this.retry.set(id, Date.now() + 10000);
    // Keep the transceivers and stream: the publisher retries ICE on this same
    // connection. Closing it here would strand the other side's negotiation.
    this.status('视频连接失败，等待重新连接');
  }
  receive(message: Signal) {
    if (!this.enabled) return;
    const host = this.room?.media?.broadcast?.host;
    if (
      message.purpose !== 'broadcast' ||
      !host ||
      !this.scope ||
      message.mediaId !== this.room?.media?.id ||
      message.epoch !== this.room.epoch ||
      !this.room.members.some((m) => m.id === message.from && m.online) ||
      (this.me !== host && message.from !== host)
    )
      return;
    const c = this.connections.get(message.from) ?? this.create(message.from);
    c.work = c.work
      .then(async () => {
        if (!this.current(message.from, c)) return;
        const d = message.data;
        if (d.kind === 'candidate') {
          const candidate = {
            candidate: d.candidate,
            sdpMid: d.sdpMid,
            sdpMLineIndex: d.sdpMLineIndex,
          };
          if (c.pc.remoteDescription) await c.pc.addIceCandidate(candidate);
          else if (c.candidates.length < 64) c.candidates.push(candidate);
        } else {
          if ((d.type === 'offer') !== (message.from === host)) return;
          await c.pc.setRemoteDescription({ type: d.type, sdp: d.sdp });
          if (!this.current(message.from, c)) return;
          for (const candidate of c.candidates.splice(0)) await c.pc.addIceCandidate(candidate);
          if (d.type === 'offer') {
            const answer = await c.pc.createAnswer();
            if (!this.current(message.from, c)) return;
            await c.pc.setLocalDescription(answer);
            if (this.current(message.from, c))
              this.signal(message.from, { kind: 'description', type: 'answer', sdp: answer.sdp! });
          }
        }
      })
      .catch(() => this.failed(message.from, c));
  }
  close() {
    for (const c of this.connections.values()) c.pc.close();
    this.connections.clear();
    this.retry.clear();
    this.incoming = null;
    this.receiveStream(null);
    this.scope = '';
  }
  release() {
    this.close();
    for (const track of this.local?.getTracks() ?? []) track.stop();
    this.local = null;
    this.localUrl = '';
  }
}
