import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  parseInvite,
  type CacheStatus,
  type Chat,
  type ClientMessage,
  type Media,
  type Member,
  type Playback,
  type ServerMessage,
  type Snapshot,
} from '../shared/protocol';
import { positionAt } from '../shared/sync';

const token = () => randomBytes(24).toString('base64url');
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export interface RoomSocket {
  readyState: number;
  bufferedAmount?: number;
  send(raw: string): void;
  close(code?: number, reason?: string): void;
}
interface Seat extends Member {
  resume: string;
  socket: RoomSocket | null;
  disconnectedAt: number;
}
export interface Room {
  code: string;
  token: string;
  mediaToken: string;
  revision: number;
  media: Media | null;
  playback: Playback;
  members: Map<string, Seat>;
  chat: Chat[];
  chatBytes: number;
  mode: 'stream' | 'cache';
  epoch: number;
  touched: number;
  ops: Map<string, true>;
  cleaned: boolean;
}
export type StoredRoom = Omit<Room, 'members' | 'ops'> & {
  members: Array<[string, Omit<Seat, 'socket'>]>;
  ops: string[];
};
export class RoomError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class Rooms {
  rooms = new Map<string, Room>();
  constructor(private now = () => Date.now()) {}
  dump(room: Room): StoredRoom {
    return {
      ...room,
      members: [...room.members].map(([id, { socket: _socket, ...seat }]) => [id, seat]),
      ops: [...room.ops.keys()],
    };
  }
  restore(saved: StoredRoom, sockets = new Map<string, RoomSocket>()) {
    const room: Room = {
      ...saved,
      members: new Map(
        saved.members.map(([id, seat]) => [
          id,
          {
            ...seat,
            socket: sockets.get(id) ?? null,
            online: sockets.has(id),
            ...(!sockets.has(id) && seat.online
              ? { disconnectedAt: this.now(), cache: this.idleCache(saved.epoch), rtt: null }
              : {}),
          },
        ]),
      ),
      ops: new Map(saved.ops.map((id) => [id, true])),
    };
    this.rooms.set(room.code, room);
    this.pauseForBarrier(room);
    return room;
  }
  idleCache(epoch: number): CacheStatus {
    return { epoch, state: 'idle', progress: 0, bytes: 0 };
  }
  create(name: string, socket: RoomSocket, preferredCode?: string): { room: Room; seat: Seat } {
    if (this.rooms.size >= 100) throw new RoomError('capacity', '服务器房间已满，请稍后再试');
    let code: string;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
      code = Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
    } while (this.rooms.has(code));
    if (preferredCode) {
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(preferredCode) || this.rooms.has(preferredCode))
        throw new RoomError('occupied', '房间地址已被使用，请重新创建');
      code = preferredCode;
    }
    const room: Room = {
      code,
      token: token(),
      mediaToken: token(),
      revision: 0,
      media: null,
      playback: {
        position: 0,
        rate: 1,
        paused: true,
        at: this.now(),
        revision: 0,
        actor: null,
        intent: 'snapshot',
      },
      members: new Map(),
      chat: [],
      chatBytes: 0,
      mode: 'stream',
      epoch: 0,
      touched: this.now(),
      ops: new Map(),
      cleaned: false,
    };
    this.rooms.set(code, room);
    return { room, seat: this.addSeat(room, name, socket) };
  }
  join(invite: string, name: string, socket: RoomSocket, resume?: string) {
    const parsed = parseInvite(invite);
    const room = parsed && this.rooms.get(parsed.code);
    if (!room || !same(room.token, parsed!.token))
      throw new RoomError('invalid_invite', '房间不存在、邀请不正确或服务已重启');
    let seat = resume && [...room.members.values()].find((s) => same(s.resume, resume));
    if (seat) {
      seat.socket?.close(4001, 'session replaced');
      seat.socket = socket;
      seat.online = true;
      seat.name = name;
      seat.rtt = null;
      seat.cache = this.idleCache(room.epoch);
      seat.ended = false;
    } else seat = this.addSeat(room, name, socket);
    this.pauseForBarrier(room);
    room.touched = this.now();
    return { room, seat };
  }
  private addSeat(room: Room, name: string, socket: RoomSocket): Seat {
    if (room.members.size >= 16) throw new RoomError('room_full', '房间最多 16 人');
    const seat: Seat = {
      id: randomUUID(),
      name,
      online: true,
      rtt: null,
      resume: token(),
      socket,
      disconnectedAt: 0,
      cache: this.idleCache(room.epoch),
      ended: false,
    };
    room.members.set(seat.id, seat);
    return seat;
  }
  cacheReady(room: Room) {
    const seats = [...room.members.values()];
    return (
      !!room.media?.source &&
      seats.length > 0 &&
      seats.every(
        (s) =>
          s.online &&
          s.cache.epoch === room.epoch &&
          s.cache.state === 'ready' &&
          !!s.cache.fingerprint,
      ) &&
      new Set(seats.map((s) => s.cache.fingerprint)).size === 1
    );
  }
  snapshot(room: Room): Snapshot {
    return {
      code: room.code,
      invite: `${room.code}:${room.token}`,
      mediaToken: room.mediaToken,
      revision: room.revision,
      media: room.media,
      playback: { ...room.playback },
      playbackAgeMs: Math.max(0, this.now() - room.playback.at),
      mode: room.mode,
      epoch: room.epoch,
      cacheReady: this.cacheReady(room),
      finished: room.cleaned,
      members: [...room.members.values()].map(({ id, name, online, rtt, cache, ended }) => ({
        id,
        name,
        online,
        rtt,
        cache,
        ended,
      })),
      chat: room.chat,
    };
  }
  send(socket: RoomSocket | null, message: ServerMessage) {
    if (socket?.readyState === 1) {
      if ((socket.bufferedAmount ?? 0) > 2 * 1024 * 1024) {
        socket.close(4008, 'slow consumer');
        return;
      }
      socket.send(JSON.stringify(message));
    }
  }
  broadcast(room: Room, message?: ServerMessage) {
    const data = message ?? { type: 'state', room: this.snapshot(room) };
    for (const s of room.members.values()) this.send(s.socket, data as ServerMessage);
  }
  disconnect(room: Room, seat: Seat, socket: RoomSocket, leave = false) {
    if (seat.socket !== socket) return;
    seat.socket = null;
    seat.online = false;
    seat.rtt = null;
    seat.disconnectedAt = this.now();
    seat.cache = this.idleCache(room.epoch);
    if (leave) room.members.delete(seat.id);
    this.pauseForBarrier(room);
    this.finishIfEveryoneEnded(room);
    room.touched = this.now();
    this.broadcast(room);
  }
  private bump(room: Room) {
    room.revision++;
    room.touched = this.now();
  }
  private paused(room: Room) {
    room.playback = {
      ...room.playback,
      position: positionAt(
        room.playback.position,
        room.playback.paused,
        room.playback.rate,
        this.now() - room.playback.at,
      ),
      paused: true,
      at: this.now(),
      revision: room.playback.revision + 1,
      intent: 'pause',
    };
    this.bump(room);
  }
  private pauseForBarrier(room: Room) {
    if (room.mode === 'cache' && !room.playback.paused && !this.cacheReady(room)) this.paused(room);
  }
  private finishIfEveryoneEnded(room: Room) {
    if (
      !room.media ||
      room.cleaned ||
      room.members.size === 0 ||
      ![...room.members.values()].every((s) => s.online && s.ended)
    )
      return;
    this.paused(room);
    room.cleaned = true;
    this.broadcast(room, { type: 'cleanup', mediaId: room.media.id, epoch: room.epoch });
    for (const s of room.members.values()) s.cache = this.idleCache(room.epoch);
  }
  act(room: Room, seat: Seat, message: ClientMessage) {
    if (!seat.online || !room.members.has(seat.id))
      throw new RoomError('not_in_room', '请重新加入房间');
    room.touched = this.now();
    if (message.type === 'signal') {
      if (
        room.mode !== 'cache' ||
        room.cleaned ||
        room.media?.id !== message.mediaId ||
        room.epoch !== message.epoch
      )
        throw new RoomError('stale_signal', '缓存连接已失效');
      const target = room.members.get(message.to);
      if (!target?.online || target.id === seat.id) return;
      this.send(target.socket, {
        type: 'signal',
        from: seat.id,
        mediaId: message.mediaId,
        epoch: message.epoch,
        data: message.data,
      });
      return;
    }
    if ('op' in message) {
      const key = `${seat.id}:${message.op}`;
      if (room.ops.has(key)) {
        this.send(seat.socket, { type: 'state', room: this.snapshot(room) });
        return;
      }
      if (message.base !== room.revision)
        throw new RoomError('conflict', '另一位成员刚刚操作了播放器，已同步最新状态，请重新操作');
    }
    switch (message.type) {
      case 'media': {
        if (room.media)
          this.broadcast(room, { type: 'cleanup', mediaId: room.media.id, epoch: room.epoch });
        room.media = { ...message.media, id: randomUUID() };
        room.epoch++;
        room.cleaned = false;
        room.mediaToken = token();
        room.playback = {
          position: 0,
          paused: true,
          rate: 1,
          at: this.now(),
          revision: room.playback.revision + 1,
          actor: seat.id,
          intent: 'snapshot',
        };
        for (const s of room.members.values()) {
          s.cache = this.idleCache(room.epoch);
          s.ended = false;
        }
        this.bump(room);
        break;
      }
      case 'mode': {
        if (!room.media) throw new RoomError('no_media', '请先分享视频');
        if (message.mode === 'cache' && !room.media.source)
          throw new RoomError('no_source', '请先在客户端识别并共享可下载的视频源');
        this.broadcast(room, { type: 'cleanup', mediaId: room.media.id, epoch: room.epoch });
        room.mode = message.mode;
        room.epoch++;
        room.cleaned = false;
        for (const s of room.members.values()) {
          s.cache = this.idleCache(room.epoch);
          s.ended = false;
        }
        this.paused(room);
        break;
      }
      case 'control': {
        if (!room.media) throw new RoomError('no_media', '请先分享视频');
        if (room.mode === 'cache' && !this.cacheReady(room) && message.action === 'play')
          throw new RoomError('cache_wait', '等待所有成员完整缓存同一视频');
        let position = positionAt(
          room.playback.position,
          room.playback.paused,
          room.playback.rate,
          this.now() - room.playback.at,
        );
        if (message.action === 'seek') {
          if (message.position === undefined) throw new RoomError('invalid', '缺少目标进度');
          position = message.position;
        }
        if (room.media.duration) position = Math.min(position, room.media.duration);
        if (message.action === 'rate' && message.rate === undefined)
          throw new RoomError('invalid', '缺少播放速度');
        room.playback = {
          position,
          rate: message.action === 'rate' ? message.rate! : room.playback.rate,
          paused:
            message.action === 'pause'
              ? true
              : message.action === 'play'
                ? false
                : room.playback.paused,
          at: this.now(),
          revision: room.playback.revision + 1,
          actor: seat.id,
          intent: message.action,
        };
        for (const s of room.members.values()) s.ended = false;
        this.bump(room);
        break;
      }
      case 'cache': {
        if (
          !room.media ||
          message.mediaId !== room.media.id ||
          message.epoch !== room.epoch ||
          room.mode !== 'cache' ||
          room.cleaned
        )
          return;
        if (
          message.state === 'ready' &&
          (!message.fingerprint || message.progress !== 1 || message.bytes < 1)
        )
          throw new RoomError('invalid_cache', '缓存尚不完整');
        seat.cache = {
          state: message.state,
          progress: message.progress,
          bytes: message.bytes,
          fingerprint: message.fingerprint,
          error: message.error,
          epoch: room.epoch,
          peerBytes: message.peerBytes,
          sourceBytes: message.sourceBytes,
        };
        this.pauseForBarrier(room);
        break;
      }
      case 'chat':
      case 'image': {
        const entry: Chat = {
          id: randomUUID(),
          memberId: seat.id,
          name: seat.name,
          at: this.now(),
          ...(message.type === 'chat' ? { text: message.text } : { image: message.image }),
        };
        const bytes = Buffer.byteLength(JSON.stringify(entry));
        room.chat.push(entry);
        room.chatBytes += bytes;
        while (room.chat.length > 100 || room.chatBytes > 2 * 1024 * 1024)
          room.chatBytes -= Buffer.byteLength(JSON.stringify(room.chat.shift()));
        break;
      }
      case 'ended': {
        if (
          !room.media ||
          room.media.id !== message.mediaId ||
          message.epoch !== room.epoch ||
          message.position < message.duration - 2 ||
          (room.media.duration && Math.abs(room.media.duration - message.duration) > 2)
        )
          return;
        seat.ended = true;
        if (!room.media.duration) room.media.duration = message.duration;
        this.finishIfEveryoneEnded(room);
        break;
      }
      case 'snapshot':
        break;
      default:
        return;
    }
    if ('op' in message) {
      room.ops.set(`${seat.id}:${message.op}`, true);
      if (room.ops.size > 512) room.ops.delete(room.ops.keys().next().value!);
    }
    this.broadcast(room);
  }
  sweep() {
    for (const room of this.rooms.values()) {
      let changed = false;
      for (const s of room.members.values())
        if (!s.online && this.now() - s.disconnectedAt > 30000) {
          room.members.delete(s.id);
          changed = true;
        }
      if (changed) {
        this.finishIfEveryoneEnded(room);
        this.broadcast(room);
      }
      if (![...room.members.values()].some((s) => s.online) && this.now() - room.touched > 900000)
        this.rooms.delete(room.code);
    }
  }
  mediaAccess(code: string, secret: string): Room | null {
    const room = this.rooms.get(code);
    return room && same(room.mediaToken, secret) ? room : null;
  }
}
