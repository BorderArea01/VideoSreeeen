import type { ClientMessage, ServerMessage, Snapshot } from '../shared/protocol';

type Signal = Extract<ServerMessage, { type: 'signal' }>;
interface Connection {
  pc: RTCPeerConnection;
  candidates: RTCIceCandidateInit[];
  work: Promise<void>;
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
  configure(room: Snapshot | null, me: string) {
    const broadcast = room?.mode === 'stream' && room.media?.broadcast;
    const scope = broadcast ? `${room!.media!.id}:${room!.epoch}` : '';
    if (scope !== this.scope || me !== this.me) {
      this.close();
      this.scope = scope;
      this.me = me;
    }
    this.room = room;
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
    for (const id of online)
      if (!this.connections.has(id) && Date.now() >= (this.retry.get(id) ?? 0)) {
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
        c.work = c.work
          .then(async () => {
            const offer = await c.pc.createOffer();
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
            this.signal(id, { kind: 'description', type: 'offer', sdp: offer.sdp! });
          })
          .catch(() => this.failed(id, c));
      }
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
    const c: Connection = { pc, candidates: [], work: Promise.resolve() };
    this.connections.set(id, c);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        this.signal(id, {
          kind: 'candidate',
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        });
    };
    pc.ontrack = (e) => {
      if (this.room?.media?.broadcast?.host === id) {
        const stream = e.streams[0];
        if (stream) this.receiveStream(stream);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.failed(id, c);
      else if (pc.connectionState === 'connected') this.status('实时画面已连接');
      else if (pc.connectionState === 'disconnected') this.status('画面连接中断，正在重连');
    };
    return c;
  }
  private failed(id: string, c: Connection) {
    c.pc.close();
    if (this.connections.get(id) !== c) return;
    this.connections.delete(id);
    this.retry.set(id, Date.now() + 10000);
    if (this.room?.media?.broadcast?.host !== this.me) this.receiveStream(null);
    this.status('无法直连视频提供者；可重试或使用各自播放');
  }
  receive(message: Signal) {
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
          for (const candidate of c.candidates.splice(0)) await c.pc.addIceCandidate(candidate);
          if (d.type === 'offer') {
            const answer = await c.pc.createAnswer();
            await c.pc.setLocalDescription(answer);
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
