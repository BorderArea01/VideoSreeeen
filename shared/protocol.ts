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
export interface CacheStatus {
  state: 'idle' | 'downloading' | 'ready' | 'error';
  progress: number;
  bytes: number;
  fingerprint?: string;
  error?: string;
  epoch: number;
  peerBytes?: number;
  sourceBytes?: number;
}
export interface Member {
  id: string;
  name: string;
  online: boolean;
  rtt: number | null;
  cache: CacheStatus;
  ended: boolean;
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
  finished: boolean;
  members: Member[];
  chat: Chat[];
}
const id = z.string().min(1).max(100);
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    name: z.string().trim().min(1).max(30),
    protocol: z.literal(PROTOCOL),
  }),
  z.object({
    type: z.literal('join'),
    name: z.string().trim().min(1).max(30),
    invite: z.string().max(200),
    resume: z.string().max(100).optional(),
    protocol: z.literal(PROTOCOL),
  }),
  z.object({ type: z.literal('leave') }),
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
  | { type: 'welcome'; memberId: string; resume: string; room: Snapshot }
  | { type: 'state'; room: Snapshot }
  | { type: 'error'; code: string; message: string; room?: Snapshot }
  | { type: 'pong'; sentAt: number }
  | { type: 'probe'; nonce: string }
  | {
      type: 'signal';
      purpose?: 'cache' | 'broadcast';
      from: string;
      mediaId: string;
      epoch: number;
      data: Extract<ClientMessage, { type: 'signal' }>['data'];
    }
  | { type: 'cleanup'; mediaId: string; epoch: number };
