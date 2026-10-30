import { z } from 'zod';

import { PROTOCOL } from './invite';
export { PROTOCOL, parseInvite } from './invite';
const webUrl = z
  .string()
  .max(8192)
  .url()
  .refine(
    (s) => /^https?:\/\//i.test(s) && !new URL(s).username && !new URL(s).password,
    '仅支持 HTTP/HTTPS 地址',
  );
export const sourceSchema = z.object({
  kind: z.enum(['file', 'hls', 'dash']),
  video: webUrl,
  audio: webUrl.optional(),
  referer: webUrl.optional(),
  bilibiliDirect: z.literal(true).optional(),
});
export type Source = z.infer<typeof sourceSchema>;
export const mediaSchema = z.object({
  url: webUrl,
  title: z.string().trim().min(1).max(200),
  provider: z.enum(['bilibili', 'xifan', 'mgn', 'direct', 'other', 'local']),
  source: sourceSchema.optional(),
  broadcast: z
    .object({ host: z.string().uuid(), kind: z.enum(['site', 'file', 'screen']) })
    .optional(),
  duration: z.number().finite().positive().max(604800).optional(),
});
export type MediaInput = z.infer<typeof mediaSchema>;
export type Media = MediaInput & { id: string; sharedBy?: string };
export interface Playback {
  position: number;
  rate: number;
  paused: boolean;
  at: number;
  revision: number;
  actor: string | null;
  intent: 'play' | 'pause' | 'seek' | 'rate' | 'snapshot';
}
export interface PlaybackClock {
  mediaId: string | null;
  epoch: number;
  revision: number;
  ageMs: number;
}
export interface CacheStatus {
  state: 'idle' | 'downloading' | 'ready' | 'error';
  progress: number;
  bytes: number;
  fingerprint?: string;
  error?: string;
  epoch: number;
  peerBytes?: number;
  sourceBytes?: number;
  parts?: string[];
  window?: { start: number; end: number };
  released?: number;
  retainedBytes?: number;
}
export interface Member {
  id: string;
  name: string;
  online: boolean;
  rtt: number | null;
  rttAgeMs?: number;
  cache: CacheStatus;
  ended: boolean;
  cachePartsSupported?: boolean;
  cacheWindowSupported?: boolean;
}
export interface Chat {
  id: string;
  memberId: string;
  name: string;
  at: number;
  text?: string;
  image?: string;
  imageFile?: { id: string; type: string; size: number };
}
export interface Snapshot {
  code: string;
  invite: string;
  mediaToken: string;
  revision: number;
  media: Media | null;
  playback: Playback;
  playbackAgeMs: number;
  mode: 'stream' | 'cache';
  epoch: number;
  cacheReady: boolean;
  cacheParts?: 1 | 2 | 3;
  cacheSliding?: boolean;
  cacheWindow?: { start: number; end: number };
  finished: boolean;
  members: Member[];
  chat: Chat[];
  kickVote?: {
    id: string;
    target: string;
    startedBy: string;
    yes: string[];
    no: string[];
    required: number;
    remainingMs: number;
  };
  kickCooldownMs?: number;
}
const id = z.string().min(1).max(100);
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    name: z.string().trim().min(1).max(30),
    protocol: z.literal(PROTOCOL),
    capabilities: z
      .array(z.enum(['latency-v1', 'cache-parts-v1', 'cache-window-v1']))
      .max(4)
      .optional(),
  }),
  z.object({
    type: z.literal('join'),
    name: z.string().trim().min(1).max(30),
    invite: z.string().max(200),
    resume: z.string().max(100).optional(),
    protocol: z.literal(PROTOCOL),
    capabilities: z
      .array(z.enum(['latency-v1', 'cache-parts-v1', 'cache-window-v1']))
      .max(4)
      .optional(),
  }),
  z.object({ type: z.literal('leave') }),
  z.object({
    type: z.literal('kick-vote'),
    action: z.enum(['start', 'yes', 'no', 'withdraw']),
    target: z.string().uuid().optional(),
    voteId: z.string().uuid().optional(),
  }),
  z.object({ type: z.literal('unshare'), base: z.number().int().nonnegative(), op: id }),
  z.object({
    type: z.literal('media'),
    base: z.number().int().nonnegative(),
    op: id,
    media: mediaSchema,
  }),
  z.object({
    type: z.literal('control'),
    base: z.number().int().nonnegative(),
    op: id,
    action: z.enum(['play', 'pause', 'seek', 'rate']),
    position: z.number().finite().min(0).max(604800).optional(),
    rate: z.number().finite().min(0.25).max(4).optional(),
  }),
  z.object({
    type: z.literal('mode'),
    base: z.number().int().nonnegative(),
    op: id,
    mode: z.enum(['stream', 'cache']),
    cacheParts: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    sliding: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('cache'),
    epoch: z.number().int().nonnegative(),
    mediaId: id,
    state: z.enum(['downloading', 'ready', 'error', 'idle']),
    progress: z.number().finite().min(0).max(1),
    bytes: z.number().int().min(0).max(17179869184),
    peerBytes: z.number().int().nonnegative().max(17179869184).optional(),
    sourceBytes: z.number().int().nonnegative().max(17179869184).optional(),
    parts: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .max(3)
      .optional(),
    window: z
      .object({
        start: z.number().finite().min(0).max(604800),
        end: z.number().finite().min(0).max(604800),
      })
      .refine((w) => w.end >= w.start)
      .optional(),
    released: z.number().int().min(0).max(3).optional(),
    retainedBytes: z.number().int().min(0).max(17179869184).optional(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    error: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(2000) }),
  z.object({
    type: z.literal('image'),
    image: z
      .string()
      .max(360000)
      .regex(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/),
  }),
  z.object({
    type: z.literal('ended'),
    mediaId: id,
    epoch: z.number().int().nonnegative(),
    position: z.number().finite().nonnegative(),
    duration: z.number().finite().positive().max(604800),
  }),
  z.object({ type: z.literal('ping'), sentAt: z.number().finite() }),
  z.object({ type: z.literal('probe'), nonce: id }),
  z.object({
    type: z.literal('signal'),
    purpose: z.enum(['cache', 'broadcast']).optional(),
    to: id,
    mediaId: id,
    epoch: z.number().int().nonnegative(),
    data: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('description'),
        type: z.enum(['offer', 'answer']),
        sdp: z.string().max(32000),
      }),
      z.object({
        kind: z.literal('candidate'),
        candidate: z.string().max(2000),
        sdpMid: z.string().nullable(),
        sdpMLineIndex: z.number().int().nonnegative().nullable(),
      }),
    ]),
  }),
  z.object({ type: z.literal('snapshot') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage =
  | { type: 'kicked'; message: string }
  | { type: 'welcome'; memberId: string; resume: string; room: Snapshot }
  | { type: 'state'; room: Snapshot }
  | { type: 'error'; code: string; message: string; room?: Snapshot }
  | { type: 'pong'; sentAt: number; clock?: PlaybackClock }
  | { type: 'probe'; nonce: string }
  | { type: 'latency'; members: Array<Pick<Member, 'id' | 'rtt' | 'rttAgeMs'>> }
  | {
      type: 'signal';
      purpose?: 'cache' | 'broadcast';
      from: string;
      mediaId: string;
      epoch: number;
      data: Extract<ClientMessage, { type: 'signal' }>['data'];
    }
  | { type: 'cleanup'; mediaId: string; epoch: number };
