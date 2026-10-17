import type Hls from 'hls.js';
import './style.css';
import { icon } from './icons';
import type { ClientMessage, MediaInput, ServerMessage, Snapshot } from '../shared/protocol';
import { PROTOCOL, parseInvite } from '../shared/invite';
import { describeUrl } from '../shared/sites';
import { positionAt, reconcile } from '../shared/sync';
import { DeviceCache } from './cache';
import { RoomPeers } from './peers';
import { isNative, nativeCall, onNative, platform, type NativeCache, type Sample } from './native';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string, title: string, name: string) =>
  `<button id="${id}" class="icon-button" title="${title}" aria-label="${title}">${icon(name)}</button>`;
const saved = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

$('app').innerHTML = `
<header class="topbar"><a class="brand" href="#" aria-label="VideoSreeeen 首页"><span class="brand-mark">${icon('film', 24)}</span><span>Video<span class="brand-light">Sreeeen</span><small>一起，把时间留给电影。</small></span></a><div class="top-actions"><span id="connection" class="connection"><i></i>尚未连接</span><span id="platform" class="platform"></span><button id="web-entry" class="button soft small" hidden>打开网页版</button>${button('settings-button', '连接设置', 'settings')}<button id="room-button" class="button accent small">${icon('plus', 17)} 创建 / 加入房间</button></div></header>
<main class="workspace"><section class="screen-column"><div class="room-heading"><div><div class="eyebrow">YOUR SHARED SCREEN</div><h1 id="room-title">同一刻，同一幕<span class="orange-dot">.</span></h1><p id="room-subtitle">不在同一个地方，也能分享同一段时光。</p></div><div class="heading-actions">${button('invite-button', '复制房间邀请', 'link')}${button('chat-toggle', '隐藏或显示聊天室', 'chat')}</div></div>
<section id="stage" class="stage"><div id="welcome" class="welcome"><div class="scene-lines"></div><div class="scene-orb"></div><div class="frame-index">V / S <span>PRIVATE CINEMA</span></div><div class="welcome-text"><span class="tag">距离很远，故事很近</span><h2>今晚的电影，<br>想和你一起看。</h2><p>创建一个放映室，发送邀请。<br>剩下的，就交给这个夜晚。</p><button id="hero-create" class="button accent">${icon('plus', 18)} 开启我们的放映室 ${icon('arrow', 17)}</button></div><div class="scene-footer"><span>PRESS PLAY. STAY CLOSE.</span><span>01 — ∞</span></div></div><video id="video" playsinline preload="metadata" hidden></video><audio id="audio" preload="metadata"></audio><div id="native-stage" class="native-stage" hidden><div class="native-hint">正在客户端内打开原站…</div></div><div id="browser-hint" class="browser-hint" hidden>${icon('globe', 36)}<h3>已共享原站页面</h3><p>浏览器暂不能直接控制此网站的播放器。<br>请让一位客户端成员打开原站，识别视频源后共享给房间。</p></div><div id="cache-overlay" class="cache-overlay" hidden><span class="cache-icon">${icon('download', 28)}</span><h3 id="cache-title">先下载，再一起看</h3><p id="cache-description">每人完整缓存，等最慢的朋友准备好。</p><div class="cache-track"><i id="cache-progress"></i></div><button id="cache-button" class="button accent">开始本机缓存</button></div></section>
<div class="transport"><button id="play-button" class="play-button" title="播放或暂停" aria-label="播放或暂停">${icon('play', 19)}</button><span id="position" class="time">00:00</span><input id="seek" aria-label="播放进度" type="range" min="0" max="100" step="0.1" value="0"><span id="duration" class="time muted">00:00</span><select id="rate" aria-label="播放速度"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>${button('fullscreen', '全屏', 'expand')}</div>
<section class="source-card"><div class="section-heading"><span>${icon('film', 18)} 今晚看什么</span><span id="provider" class="subtle">分享你喜欢的故事</span></div><form id="source-form" class="source-form"><span class="input-icon">${icon('link', 18)}</span><input id="source-url" type="url" aria-label="视频页面或视频文件地址" placeholder="粘贴 B 站、喜番、蜜柑或视频直链…" required><button class="button soft" type="submit">共享视频 ${icon('arrow', 16)}</button></form><div class="source-bottom"><div class="site-chips"><button data-site="bilibili">哔哩哔哩</button><button data-site="xifan">喜番</button><button data-site="mgn">蜜柑</button><span>+ 视频直链</span></div><button id="extract-button" class="text-button" hidden>${icon('link', 14)} 识别并共享原站视频源</button></div></section>
<section class="mode-card"><div class="mode-copy"><span class="mode-symbol">${icon('download', 22)}</span><div><h3>共同缓存模式 <span class="pill">为慢网络准备</span></h3><p id="mode-description">所有人完整下载后再播放，看完自动清理缓存。</p></div></div><button id="mode-toggle" class="switch" role="switch" aria-checked="false" aria-label="共同缓存模式"><i></i></button></section><div class="screen-foot"><span>${icon('shield', 14)} 多人可控 · 自动同步</span><span id="sync-status">等待加入房间</span></div>
</section>
<aside id="sidebar" class="sidebar"><section class="members-card"><div class="section-heading"><span>${icon('users', 18)} 放映室成员 <b id="member-count">0</b></span><span class="live-label">${icon('signal', 14)} RTT</span></div><div id="members" class="members"><p class="empty-members">座位已经留好，<br>就等朋友们到场。</p></div><button id="sidebar-invite" class="invite-line">${icon('plus', 16)} 邀请朋友一起看</button></section><section id="chat-panel" class="chat-panel"><div id="chat-drag" class="chat-heading"><div>${icon('chat', 18)} 聊天室 <span class="tiny-dot"></span></div><div><span class="drag-hint">拖拽悬浮</span>${button('chat-dock', '停靠聊天室', 'expand')}</div></div><div id="chat-messages" class="chat-messages"><div id="chat-empty" class="chat-empty"><span>${icon('chat', 30)}</span><p>好故事，值得边看边聊。</p><small>加入房间后，消息会出现在这里。</small></div></div><div id="emoji-picker" class="emoji-picker" hidden></div><div class="chat-compose"><textarea id="chat-input" aria-label="聊天消息" placeholder="说点什么，分享这一刻…" rows="2" maxlength="2000"></textarea><div class="compose-actions"><div>${button('emoji-button', '选择表情', 'smile')}${button('image-button', '发送图片或 GIF 表情包', 'image')}<input id="image-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden></div><button id="send-button" class="send-button" title="发送消息" aria-label="发送消息">${icon('send', 17)}</button></div><small>Enter 发送 · Shift + Enter 换行</small></div></section><div class="sidebar-foot">MADE FOR MOMENTS TOGETHER <span>✳</span></div></aside></main>
<footer class="app-foot"><span>VideoSreeeen <b>0.2</b></span><span>让每一次播放，都有陪伴。</span><button id="leave-button" class="text-button" hidden>${icon('exit', 14)} 离开放映室</button></footer>
<dialog id="room-dialog"><form id="room-form"><div class="dialog-heading"><div><div class="eyebrow">LET'S WATCH TOGETHER</div><h2>你的专属放映室</h2></div><button id="dialog-close" type="button" class="icon-button" aria-label="关闭">${icon('close')}</button></div><p class="dialog-copy">取个名字，带上朋友。无需注册，也不用安装扩展。</p><label>你的昵称<input id="name-input" maxlength="30" placeholder="让朋友认出你" required></label><label>房间服务器<input id="server-input" type="url" placeholder="https://你的服务器" required></label><label>邀请链接或邀请码 <span class="muted">（加入时填写）</span><input id="invite-input" placeholder="ABC234:邀请密钥"></label><p class="dialog-note">自己建房可以留空邀请码。局域网内，手机请填写电脑的局域网地址。</p><div class="dialog-buttons"><button id="create-button" type="submit" class="button accent">创建房间</button><button id="join-button" type="button" class="button outline">加入朋友的房间</button></div><p id="dialog-error" class="form-error" role="alert"></p></form></dialog><div id="toast" class="toast" role="status" hidden></div>`;

$('platform').textContent = platform;
$('web-entry').hidden = !window.desktop;
$('web-entry').onclick = () => {
  void nativeCall('openBrowser', {
    url: activeServer || $<HTMLInputElement>('server-input').value,
  }).catch(error);
};
const video = $<HTMLVideoElement>('video'),
  audio = $<HTMLAudioElement>('audio');
const dialog = $<HTMLDialogElement>('room-dialog');
const publicServer =
  (import.meta as ImportMeta & { env: { VITE_PUBLIC_SERVER?: string } }).env.VITE_PUBLIC_SERVER ||
  '';
const defaultServer =
  /^https?:$/.test(location.protocol) && location.hostname !== 'videosreeeen.local'
    ? location.port === '5173'
      ? `${location.protocol}//${location.hostname}:8787`
      : location.origin
    : publicServer || 'http://127.0.0.1:8787';
$<HTMLInputElement>('server-input').value = saved('server') || defaultServer;
$<HTMLInputElement>('name-input').value = saved('name');
if (parseInvite(location.hash.slice(1)))
  $<HTMLInputElement>('invite-input').value = location.hash.slice(1);
if (window.desktop && !saved('server') && !publicServer)
  void nativeCall('serverInfo')
    .then((info) => {
      if (info?.share) $<HTMLInputElement>('server-input').value = info.share;
    })
    .catch(error);
$<HTMLInputElement>('invite-input').addEventListener('input', () => {
  const value = $<HTMLInputElement>('invite-input').value.trim();
  if (parseInvite(value) && /^https?:/.test(value))
    $<HTMLInputElement>('server-input').value = new URL(value).origin;
});
let ws: WebSocket | null = null,
  room: Snapshot | null = null,
  memberId = '',
  resume = '',
  activeServer = '',
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let desiredSession = false,
  connected = false,
  retries = 0,
  anchoredAt = 0,
  rtt: number | null = null;
let mediaRelay = true;
let clearing: Promise<void> = Promise.resolve();
let cacheContext: { jobId: string; mediaId: string; epoch: number } | null = null;
let hls: Hls | null = null,
  loadedMedia = '',
  loadedKind = '',
  catchingUp = false,
  lastRevision = -1,
  lastRemoteSeq = -1,
  remoteFrame = '',
  siteOpen = false,
  pendingControl = false,
  playerGeneration = 0;
let nativeBusy = false,
  siteSample: Sample | null = null,
  cacheStartBusy = false,
  cleanupState: 'idle' | 'running' | 'done' | 'error' = 'idle';
let renderedChat = '',
  lastChatLength = 0;

function toast(message: string) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 5000);
}
let toastTimer: ReturnType<typeof setTimeout>;
function error(error: unknown) {
  toast(error instanceof Error ? error.message : String(error));
}
function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function send(message: ClientMessage) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !connected) {
    toast('连接尚未恢复，请稍后操作');
    return false;
  }
  ws.send(JSON.stringify(message));
  return true;
}
function operation(message: Record<string, unknown>) {
  if (!room || !connected) {
    toast('请先创建或加入房间');
    return;
  }
  pendingControl = true;
  if (!send({ ...message, base: room.revision, op: crypto.randomUUID() } as ClientMessage))
    pendingControl = false;
}
function control(action: 'play' | 'pause' | 'seek' | 'rate', extra: Record<string, number> = {}) {
  operation({ type: 'control', action, ...extra });
}
function currentPosition() {
  return room
    ? positionAt(
        room.playback.position,
        room.playback.paused,
        room.playback.rate,
        performance.now() - anchoredAt,
      )
    : 0;
}
function connectionView(status: string, online = false) {
  $('connection').replaceChildren();
  const dot = document.createElement('i');
  $('connection').append(dot, status);
  $('connection').classList.toggle('online', online);
}
function openDialog() {
  void hideSite(true);
  dialog.showModal();
}
function closeDialog() {
  dialog.close();
  void resizeSite();
}
async function connect(kind: 'create' | 'join', reconnect = false) {
  const name = $<HTMLInputElement>('name-input').value.trim(),
    rawServer = $<HTMLInputElement>('server-input').value.trim();
  if (!name) throw new Error('请填写昵称');
  const server = new URL(rawServer);
  if (
    !['http:', 'https:'].includes(server.protocol) ||
    server.username ||
    server.password ||
    (server.pathname !== '/' && server.pathname !== '')
  )
    throw new Error('服务器地址需为 HTTP/HTTPS 根地址');
  if (location.protocol === 'https:' && !isNative && server.protocol !== 'https:')
    throw new Error('HTTPS 页面需要连接 HTTPS 服务器');
  const invite = reconnect && room ? room.invite : $<HTMLInputElement>('invite-input').value.trim();
  if (kind === 'join' && !parseInvite(invite)) throw new Error('请填写有效的邀请链接或完整邀请码');
  activeServer = server.origin;
  save('server', activeServer);
  save('name', name);
  desiredSession = true;
  if (!reconnect) {
    resume = '';
    room = null;
    memberId = '';
    await clearPlayback();
  }
  clearTimeout(reconnectTimer);
  ws?.close();
  connected = false;
  connectionView(reconnect ? '正在重新连接' : '正在连接');
  mediaRelay = true;
  peers.setIceServers([], false);
  let roomRouting = false;
  try {
    const response = await fetch(activeServer + '/config', { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const config = await response.json();
      mediaRelay = config.mediaRelay !== false;
      roomRouting = config.roomRouting === true;
      peers.setIceServers(
        Array.isArray(config.iceServers) ? config.iceServers : [],
        config.p2p === true,
      );
    }
  } catch {
    mediaRelay = true;
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code =
    kind === 'join'
      ? parseInvite(invite)!.code
      : Array.from(
          crypto.getRandomValues(new Uint8Array(6)),
          (b) => alphabet[b % alphabet.length],
        ).join('');
  const socket = new WebSocket(
    activeServer.replace(/^http/, 'ws') + '/ws' + (roomRouting ? '?room=' + code : ''),
  );
  ws = socket;
  return new Promise<void>((resolve, reject) => {
    let welcomed = false;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('连接服务器超时'));
    }, 12000);
    socket.onopen = () =>
      socket.send(
        JSON.stringify(
          kind === 'create'
            ? { type: 'create', name, protocol: PROTOCOL }
            : { type: 'join', name, protocol: PROTOCOL, invite, ...(resume ? { resume } : {}) },
        ),
      );
    socket.onmessage = (event) => {
      if (ws !== socket) return;
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'welcome') {
          clearTimeout(timeout);
          welcomed = true;
          connected = true;
          retries = 0;
          memberId = message.memberId;
          resume = message.resume;
          adopt(message.room);
          closeDialog();
          connectionView('同步连接正常', true);
          resolve();
        } else if (message.type === 'state') {
          pendingControl = false;
          adopt(message.room);
        } else if (message.type === 'error') {
          pendingControl = false;
          if (message.room) adopt(message.room);
          if (!welcomed) {
            clearTimeout(timeout);
            desiredSession = false;
            reject(new Error(message.message));
            socket.close();
          } else toast(message.message);
        } else if (message.type === 'pong') rtt = Math.max(0, performance.now() - message.sentAt);
        else if (message.type === 'probe') send({ type: 'probe', nonce: message.nonce });
        else if (message.type === 'signal') peers.receive(message);
        else if (
          message.type === 'cleanup' &&
          room?.media?.id === message.mediaId &&
          room.epoch === message.epoch
        ) {
          cleanupState = 'running';
          void stopCachedPlayback()
            .then(() => {
              if (room?.media?.id === message.mediaId && room.epoch === message.epoch) {
                cleanupState = 'done';
                render();
              }
              if (
                room?.media?.id === message.mediaId &&
                room.epoch === message.epoch &&
                room.finished
              )
                toast('本轮本机应用缓存已清理');
            })
            .catch((e) => {
              cleanupState = 'error';
              render();
              error(e);
            });
        }
      } catch (e) {
        error(e);
      }
    };
    socket.onerror = () => {
      if (!welcomed) {
        clearTimeout(timeout);
        reject(new Error('无法连接房间服务器，请检查地址和网络'));
      }
    };
    socket.onclose = () => {
      clearTimeout(timeout);
      if (ws !== socket) return;
      connected = false;
      peers.close();
      pendingControl = false;
      connectionView('连接已断开');
      video.pause();
      audio.pause();
      if (!welcomed) reject(new Error('服务器连接已关闭'));
      if (desiredSession && room) {
        if (room.mode === 'cache') void stopCachedPlayback().catch(error);
        const delay = Math.min(15000, 1000 * 2 ** Math.min(retries++, 4));
        reconnectTimer = setTimeout(() => {
          void connect('join', true).catch(error);
        }, delay);
      }
    };
  });
}
function adopt(snapshot: Snapshot) {
  const previous = room;
  const changed = previous?.media?.id !== snapshot.media?.id || previous?.epoch !== snapshot.epoch;
  if (changed) {
    cacheContext = null;
    cleanupState = 'idle';
    clearing = clearPlayback();
    lastRevision = -1;
    lastRemoteSeq = -1;
    remoteFrame = '';
  }
  room = snapshot;
  // Accept offers immediately. Native file cleanup may finish after signaling
  // has already arrived; starting a new download still awaits `clearing`.
  peers.configure(room, memberId);
  if (changed) void clearing.catch(error);
  anchoredAt = performance.now() - snapshot.playbackAgeMs - (rtt ?? 0) / 2;
  render();
  if (
    snapshot.media &&
    snapshot.mode === 'stream' &&
    (loadedMedia !== snapshot.media.id || loadedKind === 'cache')
  )
    void loadStream(snapshot.media);
  if (!previous || changed || previous.playback.revision !== snapshot.playback.revision)
    applyPlayback(true);
}
function render() {
  const joined = !!room;
  $('room-title').textContent = room
    ? (room.media?.title ?? `放映室 ${room.code}`)
    : '同一刻，同一幕。';
  $('room-subtitle').textContent = room
    ? `${room.code} · ${room.members.filter((m) => m.online).length} 位朋友在场 · 每个人都可以控制播放`
    : '不在同一个地方，也能分享同一段时光。';
  $('room-button').innerHTML = joined
    ? `${icon('copy', 16)} 复制邀请`
    : `${icon('plus', 17)} 创建 / 加入房间`;
  $('provider').textContent = room?.media
    ? { bilibili: '哔哩哔哩', xifan: '喜番', mgn: '蜜柑', direct: '视频直链', other: '其他网站' }[
        room.media.provider
      ]
    : '分享你喜欢的故事';
  $('leave-button').hidden = !joined;
  $('member-count').textContent = String(room?.members.length ?? 0);
  const members = $('members');
  members.replaceChildren();
  if (!room) {
    const p = document.createElement('p');
    p.className = 'empty-members';
    p.textContent = '座位已经留好，就等朋友们到场。';
    members.append(p);
  }
  for (const member of room?.members ?? []) {
    const row = document.createElement('div');
    row.className = 'member';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = [...member.name][0] || '友';
    const info = document.createElement('div');
    info.className = 'member-info';
    const name = document.createElement('strong');
    name.textContent = member.name + (member.id === memberId ? '（我）' : '');
    const detail = document.createElement('small');
    detail.textContent = !member.online
      ? '已断线 · 等待重连'
      : room!.finished
        ? '已看完'
        : room!.mode === 'cache'
          ? {
              idle: '等待缓存',
              downloading: `缓存 ${Math.floor(member.cache.progress * 100)}%`,
              ready: '缓存完成',
              error: member.cache.error ?? '缓存失败',
            }[member.cache.state]
          : '在线';
    info.append(name, detail);
    const latency = document.createElement('span');
    latency.className = `latency ${member.rtt !== null && member.rtt > 180 ? 'slow' : ''}`;
    latency.textContent = member.online && member.rtt !== null ? `${member.rtt} ms` : '—';
    row.append(avatar, info, latency);
    members.append(row);
  }
  renderChat();
  const caching = room?.mode === 'cache';
  $('mode-toggle').setAttribute('aria-checked', String(!!caching));
  const hashes = new Set(
    room?.members.filter((m) => m.cache.state === 'ready').map((m) => m.cache.fingerprint),
  );
  $('mode-description').textContent = room?.finished
    ? cleanupState === 'done'
      ? '本轮已经看完，本机应用缓存已清理。'
      : cleanupState === 'error'
        ? '本轮已结束，缓存清理失败，请重新启动客户端清扫。'
        : '本轮已结束，正在清理本机应用缓存。'
    : caching
      ? hashes.size > 1
        ? '视频内容不一致，请重新识别并让大家缓存同一份视频。'
        : room!.cacheReady
          ? '大家都已准备好，可以一起开始播放。'
          : '等待所有成员完整缓存，期间无法开始播放。'
      : '所有人完整下载后再播放，看完自动清理缓存。';
  const mine = room?.members.find((m) => m.id === memberId)?.cache;
  const needsCache = !!caching && (!room?.cacheReady || loadedKind !== 'cache');
  $('cache-overlay').hidden = !needsCache;
  $('cache-progress').style.width = `${Math.round((mine?.progress ?? 0) * 100)}%`;
  $('cache-title').textContent = room?.finished
    ? cleanupState === 'done'
      ? '这一幕已结束，缓存已清理'
      : cleanupState === 'error'
        ? '缓存清理失败'
        : '这一幕已结束，正在清理缓存'
    : mine?.state === 'ready'
      ? '本机已准备好'
      : mine?.state === 'downloading'
        ? `正在完整缓存 · ${Math.floor(mine.progress * 100)}%`
        : '先下载，再一起看';
  $('cache-description').textContent =
    mine?.state === 'error'
      ? (mine.error ?? '缓存失败')
      : mine?.state === 'ready'
        ? '等待其他朋友准备好，再开始播放。'
        : '优先从房间成员互传，连接失败时回退下载。看完自动清理。';
  if (mine?.peerBytes !== undefined)
    $('cache-description').textContent +=
      ` 已从成员接收 ${(mine.peerBytes / 1024 ** 2).toFixed(1)} MiB，源站 ${((mine.sourceBytes ?? 0) / 1024 ** 2).toFixed(1)} MiB。`;
  if (cacheNote && mine?.state === 'downloading')
    $('cache-description').textContent += ' ' + cacheNote;
  $<HTMLButtonElement>('cache-button').disabled =
    cacheStartBusy || mine?.state === 'downloading' || mine?.state === 'ready';
  $('cache-button').textContent = room?.finished
    ? '重新准备这一部'
    : mine?.state === 'ready'
      ? '等待全员就绪'
      : mine?.state === 'downloading'
        ? '正在下载…'
        : '开始本机缓存';
  $('extract-button').hidden =
    !isNative || !room?.media || room.media.provider === 'direct' || caching;
  $('welcome').hidden = !!room?.media;
  $('play-button').innerHTML = icon(room?.playback.paused !== false ? 'play' : 'pause', 19);
  $<HTMLSelectElement>('rate').value = String(room?.playback.rate ?? 1);
  if (caching && !room?.cacheReady) {
    video.pause();
    audio.pause();
  }
  void resizeSite();
}
function renderChat() {
  const signature = room ? `${room.code}:${room.chat.at(-1)?.id ?? ''}:${room.chat.length}` : '';
  if (signature === renderedChat) return;
  renderedChat = signature;
  const messages = $('chat-messages');
  const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
  messages.replaceChildren();
  if (!room?.chat.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.innerHTML = `<span>${icon('chat', 30)}</span><p>好故事，值得边看边聊。</p><small>${room ? '发出今晚的第一条消息吧。' : '加入房间后，消息会出现在这里。'}</small>`;
    messages.append(empty);
  }
  for (const message of room?.chat ?? []) {
    const row = document.createElement('div');
    row.className = `message ${message.memberId === memberId ? 'mine' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = `${message.name} · ${new Date(message.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (message.text) bubble.textContent = message.text;
    if (message.image && /^data:image\/(png|jpeg|gif|webp);base64,/.test(message.image)) {
      const img = document.createElement('img');
      img.src = message.image;
      img.alt = `${message.name} 发来的表情图片`;
      img.loading = 'lazy';
      img.onload = () => {
        if (nearBottom) messages.scrollTop = messages.scrollHeight;
      };
      bubble.append(img);
    }
    row.append(meta, bubble);
    messages.append(row);
  }
  if (nearBottom || (room?.chat.length ?? 0) !== lastChatLength)
    messages.scrollTop = messages.scrollHeight;
  lastChatLength = room?.chat.length ?? 0;
}
async function clearPlayback() {
  playerGeneration++;
  loadedMedia = '';
  loadedKind = '';
  hls?.destroy();
  hls = null;
  video.pause();
  audio.pause();
  video.removeAttribute('src');
  audio.removeAttribute('src');
  video.load();
  audio.load();
  video.hidden = true;
  $('browser-hint').hidden = true;
  $('native-stage').hidden = true;
  siteOpen = false;
  if (isNative) await nativeCall('closeSite').catch(error);
  await cache.clear().catch(error);
}
async function stopCachedPlayback() {
  cacheContext = null;
  if (loadedKind === 'cache') {
    hls?.destroy();
    hls = null;
    video.pause();
    audio.pause();
    video.removeAttribute('src');
    audio.removeAttribute('src');
    video.load();
    audio.load();
    loadedKind = '';
    loadedMedia = '';
  }
  await cache.clear();
}
function mediaPath(slot: string) {
  if (!mediaRelay && room?.media?.source)
    return slot === 'audio' ? room.media.source.audio! : room.media.source.video;
  return `${activeServer}/media/${room!.code}/${room!.mediaToken}/${slot}`;
}
async function setPlayer(src: string, audioSrc?: string, isHls = false) {
  const generation = ++playerGeneration;
  hls?.destroy();
  hls = null;
  video.hidden = false;
  $('browser-hint').hidden = true;
  $('native-stage').hidden = true;
  if (audioSrc) {
    audio.src = audioSrc;
    video.muted = true;
  } else {
    audio.removeAttribute('src');
    audio.load();
    video.muted = false;
  }
  if (isHls) {
    const { default: Hls } = await import('hls.js');
    if (generation !== playerGeneration) return;
    if (Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, backBufferLength: 15, enableWorker: false });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) toast('视频流加载失败：' + data.details);
      });
    } else video.src = src;
  } else video.src = src;
  if (!hls) video.load();
}
async function loadStream(media: NonNullable<Snapshot['media']>) {
  loadedMedia = media.id;
  loadedKind = 'stream';
  if (media.source) {
    await hideSite(true);
    siteOpen = false;
    await setPlayer(
      mediaPath('video'),
      media.source.audio ? mediaPath('audio') : undefined,
      media.source.kind === 'hls',
    );
  } else if (isNative) {
    video.hidden = true;
    siteOpen = true;
    $('native-stage').hidden = false;
    try {
      await nativeCall('openSite', { url: media.url });
      await resizeSite();
    } catch (e) {
      error(e);
    }
  } else {
    video.hidden = true;
    $('browser-hint').hidden = false;
  }
}
function applyPlayback(explicit = false) {
  if (!room || !connected || pendingControl || (room.mode === 'cache' && !room.cacheReady)) return;
  const playback = room.playback,
    target = currentPosition();
  const seek = explicit && lastRevision !== playback.revision && playback.intent === 'seek';
  lastRevision = playback.revision;
  if (siteOpen) {
    if (!nativeBusy) {
      nativeBusy = true;
      void nativeCall('applySite', {
        position: target,
        rate: playback.rate,
        paused: playback.paused,
        seek,
      })
        .catch(error)
        .finally(() => {
          nativeBusy = false;
        });
    }
    return;
  }
  if (
    video.hidden ||
    video.readyState < 1 ||
    (video.ended && room.members.find((m) => m.id === memberId)?.ended)
  )
    return;
  const correction = reconcile(
    video.currentTime,
    target,
    playback.rate,
    playback.paused,
    seek,
    catchingUp,
  );
  catchingUp = correction.kind === 'rate';
  if (correction.kind === 'seek' && Number.isFinite(target))
    video.currentTime = Math.min(
      target,
      Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.01) : target,
    );
  if (Math.abs(video.playbackRate - correction.rate) > 0.001) video.playbackRate = correction.rate;
  if (audio.src) {
    if (Math.abs(audio.currentTime - video.currentTime) > 0.15)
      audio.currentTime = video.currentTime;
    audio.playbackRate = video.playbackRate;
  }
  if (playback.paused) {
    video.pause();
    audio.pause();
  } else {
    if (video.paused)
      void video.play().catch(() => {
        $('sync-status').textContent = '请点击播放以允许浏览器播放声音';
      });
    if (audio.src && audio.paused) void audio.play().catch(() => toast('请点击播放以启用音频'));
  }
}
async function hideSite(hide: boolean) {
  if (isNative && siteOpen)
    await nativeCall('siteBounds', {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      viewportWidth: innerWidth,
      hidden: hide,
    });
}
async function resizeSite() {
  if (!isNative || !siteOpen) return;
  if (dialog.open || room?.mode === 'cache') {
    await hideSite(true);
    return;
  }
  const rect = $('native-stage').getBoundingClientRect();
  let bounds = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: 0, height: 0 };
  bounds.width = Math.max(0, Math.min(innerWidth, rect.right) - bounds.x);
  bounds.height = Math.max(0, Math.min(innerHeight, rect.bottom) - bounds.y);
  const panel = $('chat-panel');
  if (panel.classList.contains('floating') && !$('sidebar').hidden) {
    const chat = panel.getBoundingClientRect();
    const right = bounds.x + bounds.width,
      bottom = bounds.y + bounds.height;
    if (chat.left < right && chat.right > bounds.x && chat.top < bottom && chat.bottom > bounds.y) {
      const regions = [
        { ...bounds, width: Math.max(0, chat.left - bounds.x - 8) },
        { ...bounds, x: chat.right + 8, width: Math.max(0, right - chat.right - 8) },
        { ...bounds, height: Math.max(0, chat.top - bounds.y - 8) },
        { ...bounds, y: chat.bottom + 8, height: Math.max(0, bottom - chat.bottom - 8) },
      ];
      bounds = regions.sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
    }
  }
  await nativeCall('siteBounds', {
    ...bounds,
    viewportWidth: innerWidth,
    hidden: bounds.width < 96 || bounds.height < 64,
  }).catch(error);
}
const peers = new RoomPeers(send);
const cache = new DeviceCache(cacheProgress, peers);
let lastProgressSend = 0;
let cacheNote = '';
function cacheProgress(event: NativeCache) {
  if (
    event.jobId !== cache.jobId ||
    !room?.media ||
    room.mode !== 'cache' ||
    cacheContext?.jobId !== event.jobId ||
    cacheContext.mediaId !== room.media.id ||
    cacheContext.epoch !== room.epoch
  )
    return;
  if (event.state === 'downloading' && event.error) cacheNote = event.error;
  const now = performance.now();
  if (event.state !== 'downloading' || now - lastProgressSend > 800) {
    lastProgressSend = now;
    send({
      type: 'cache',
      mediaId: room.media.id,
      epoch: room.epoch,
      state: event.state,
      progress: event.progress,
      bytes: event.bytes,
      peerBytes: event.peerBytes,
      sourceBytes: event.sourceBytes,
      ...(event.fingerprint ? { fingerprint: event.fingerprint } : {}),
      ...(event.error ? { error: event.error } : {}),
    });
  }
  if (event.state === 'ready' && event.entry) {
    loadedKind = 'cache';
    loadedMedia = room.media.id;
    siteOpen = false;
    void nativeCall('closeSite').catch(() => {});
    void setPlayer(event.entry, event.audio, event.entry.includes('.m3u8')).then(() =>
      applyPlayback(true),
    );
  }
}
onNative((type, data) => {
  if (type === 'cache') cacheProgress(data as NativeCache);
  if (type === 'site-error') error(data.message);
});

$('room-button').onclick = () => {
  if (room) void invite();
  else openDialog();
};
$('hero-create').onclick = () => {
  if (room) $<HTMLInputElement>('source-url').focus();
  else openDialog();
};
$('sidebar-invite').onclick = () => {
  if (room) void invite();
  else openDialog();
};
$('settings-button').onclick = openDialog;
$('dialog-close').onclick = closeDialog;
$('room-form').onsubmit = (event) => {
  event.preventDefault();
  $('dialog-error').textContent = '';
  void connect('create').catch((e) => {
    $('dialog-error').textContent = e.message;
  });
};
$('join-button').onclick = () => {
  $('dialog-error').textContent = '';
  void connect('join').catch((e) => {
    $('dialog-error').textContent = e.message;
  });
};
async function invite() {
  if (!room) {
    openDialog();
    return;
  }
  const value = `${activeServer}/#${room.invite}`;
  try {
    await navigator.clipboard.writeText(value);
    toast('邀请已复制，发给朋友即可加入');
  } catch {
    $<HTMLInputElement>('invite-input').value = value;
    openDialog();
    $<HTMLInputElement>('invite-input').select();
    toast('浏览器不允许自动复制，请复制已选中的邀请');
  }
}
$('invite-button').onclick = () => {
  void invite();
};
$('source-form').onsubmit = (event) => {
  event.preventDefault();
  try {
    const media = describeUrl($<HTMLInputElement>('source-url').value);
    operation({ type: 'media', media });
  } catch (e) {
    error(e);
  }
};
const examples: Record<string, string> = {
  bilibili: 'https://www.bilibili.com/video/BV1KQp565ENm/',
  xifan: 'https://next.xifanacg.com/anime/151/play/1985?source=xfy2',
  mgn: 'https://www.mgnacg.com/bangumi/193-2-16/',
};
for (const node of document.querySelectorAll<HTMLButtonElement>('[data-site]'))
  node.onclick = () => {
    $<HTMLInputElement>('source-url').value = examples[node.dataset.site!]!;
  };
$('extract-button').onclick = () => {
  void (async () => {
    if (!room?.media) return;
    const sample = (await nativeCall('sampleSite')) as Sample;
    const source = sample.source;
    if (!source) throw new Error('还未识别到可共享的视频源，请在原站登录并开始播放，再重试');
    const media: MediaInput = {
      url: room.media.url,
      provider: room.media.provider,
      title: sample.title || room.media.title,
      source,
      ...(sample.duration && sample.duration > 0 ? { duration: sample.duration } : {}),
    };
    operation({ type: 'media', media });
  })().catch(error);
};
$('play-button').onclick = () => {
  if (!room?.playback.paused) control('pause');
  else {
    if (!video.hidden && video.src && !(room?.mode === 'cache' && !room.cacheReady)) {
      void video.play().catch(error);
      if (audio.src) void audio.play().catch(error);
    }
    control('play');
  }
};
video.onclick = () => $('play-button').click();
$<HTMLInputElement>('seek').onchange = () =>
  control('seek', { position: Number($<HTMLInputElement>('seek').value) });
$<HTMLSelectElement>('rate').onchange = () =>
  control('rate', { rate: Number($<HTMLSelectElement>('rate').value) });
$('fullscreen').onclick = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void $('stage').requestFullscreen().catch(error);
};
$('mode-toggle').onclick = () =>
  operation({ type: 'mode', mode: room?.mode === 'cache' ? 'stream' : 'cache' });
$('cache-button').onclick = () => {
  if (room?.finished) {
    operation({ type: 'mode', mode: 'cache' });
    return;
  }
  void (async () => {
    if (!room?.media) return;
    const mediaId = room.media.id,
      epoch = room.epoch;
    const jobId = crypto.randomUUID();
    cacheStartBusy = true;
    cacheNote = '';
    send({ type: 'cache', mediaId, epoch, state: 'downloading', progress: 0, bytes: 0 });
    render();
    try {
      await clearing;
      if (room?.media?.id !== mediaId || room.epoch !== epoch || !room.media.source) return;
      peers.configure(room, memberId);
      cacheContext = { jobId, mediaId, epoch };
      await cache.start(
        jobId,
        activeServer,
        `/cache-plan/${room.code}/${room.mediaToken}`,
        room.media.source,
      );
    } catch (e) {
      if (room?.media?.id === mediaId && room.epoch === epoch) {
        send({
          type: 'cache',
          mediaId,
          epoch,
          state: 'error',
          progress: 0,
          bytes: 0,
          error: (e instanceof Error ? e.message : '缓存失败').slice(0, 200),
        });
        error(e);
      }
    } finally {
      cacheStartBusy = false;
      render();
    }
  })();
};
const ended = () => {
  if (room?.media && video.duration && video.currentTime >= video.duration - 2)
    send({
      type: 'ended',
      mediaId: room.media.id,
      epoch: room.epoch,
      position: video.currentTime,
      duration: video.duration,
    });
};
video.onended = ended;
video.onloadedmetadata = () => applyPlayback(true);
video.onerror = () => {
  if (video.getAttribute('src')) toast('视频无法播放：源可能已过期或格式不受支持，请重新识别');
};
$('leave-button').onclick = () => {
  desiredSession = false;
  clearTimeout(reconnectTimer);
  send({ type: 'leave' });
  ws?.close();
  ws = null;
  connected = false;
  room = null;
  resume = '';
  memberId = '';
  void clearPlayback();
  connectionView('尚未连接');
  render();
};
function sendChat() {
  const input = $<HTMLTextAreaElement>('chat-input'),
    text = input.value.trim();
  if (text && send({ type: 'chat', text })) {
    input.value = '';
    $('emoji-picker').hidden = true;
  }
}
$('send-button').onclick = sendChat;
$<HTMLTextAreaElement>('chat-input').onkeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendChat();
  }
};
for (const emoji of [
  '😀',
  '😂',
  '🥹',
  '😍',
  '🥳',
  '😭',
  '🤔',
  '😱',
  '👍',
  '👏',
  '❤️',
  '🍿',
  '🎬',
  '☕',
  '👀',
  '✨',
]) {
  const b = document.createElement('button');
  b.textContent = emoji;
  b.onclick = () => {
    $<HTMLTextAreaElement>('chat-input').value += emoji;
    $<HTMLTextAreaElement>('chat-input').focus();
  };
  $('emoji-picker').append(b);
}
$('emoji-button').onclick = () => {
  $('emoji-picker').hidden = !$('emoji-picker').hidden;
};
$('image-button').onclick = () => {
  if (!room) toast('请先加入房间');
  else $('image-input').click();
};
$<HTMLInputElement>('image-input').onchange = () => {
  const input = $<HTMLInputElement>('image-input');
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 256 * 1024) {
    toast('表情图片请小于 256 KiB，支持 GIF');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    send({ type: 'image', image: String(reader.result) });
    input.value = '';
  };
  reader.readAsDataURL(file);
};
$('chat-toggle').onclick = () => {
  $('sidebar').hidden = !$('sidebar').hidden;
  document.body.classList.toggle('chat-hidden', $('sidebar').hidden);
  void resizeSite();
};
let dragging: { x: number; y: number; left: number; top: number } | null = null;
$('chat-drag').onpointerdown = (event) => {
  if ((event.target as HTMLElement).closest('button')) return;
  const panel = $('chat-panel');
  const r = panel.getBoundingClientRect();
  panel.classList.add('floating');
  panel.style.left = r.left + 'px';
  panel.style.top = r.top + 'px';
  dragging = { x: event.clientX, y: event.clientY, left: r.left, top: r.top };
  $('chat-drag').setPointerCapture(event.pointerId);
  void resizeSite();
};
$('chat-drag').onpointermove = (event) => {
  if (!dragging) return;
  $('chat-panel').style.left =
    Math.max(
      0,
      Math.min(
        innerWidth - $('chat-panel').offsetWidth,
        dragging.left + event.clientX - dragging.x,
      ),
    ) + 'px';
  $('chat-panel').style.top =
    Math.max(
      0,
      Math.min(
        innerHeight - $('chat-panel').offsetHeight,
        dragging.top + event.clientY - dragging.y,
      ),
    ) + 'px';
  void resizeSite();
};
$('chat-drag').onpointerup = () => {
  dragging = null;
};
$('chat-dock').onclick = () => {
  $('chat-panel').classList.remove('floating');
  $('chat-panel').style.left = '';
  $('chat-panel').style.top = '';
  void resizeSite();
};
window.addEventListener('resize', () => {
  void resizeSite();
});
window.addEventListener(
  'scroll',
  () => {
    void resizeSite();
  },
  true,
);
document.addEventListener('fullscreenchange', () => {
  void resizeSite();
});
window.addEventListener('beforeunload', () => {
  desiredSession = false;
  ws?.close();
});
window.addEventListener('pagehide', () => {
  void cache.clear().catch(() => {});
});
setInterval(() => {
  if (room) {
    applyPlayback();
    const position = currentPosition(),
      duration =
        room.media?.duration ||
        (Number.isFinite(video.duration) ? video.duration : siteSample?.duration) ||
        0;
    $('position').textContent = clock(position);
    $('duration').textContent = clock(duration);
    const seek = $<HTMLInputElement>('seek');
    seek.max = String(duration || 100);
    if (document.activeElement !== seek) seek.value = String(position);
    $('sync-status').textContent = !connected
      ? '离线 · 暂停控制'
      : room.mode === 'cache' && !room.cacheReady
        ? '等待完整缓存'
        : `WebSocket 同步${rtt === null ? '' : ' · ' + Math.round(rtt) + ' ms'}`;
  }
}, 300);
setInterval(() => {
  if (connected) send({ type: 'ping', sentAt: performance.now() });
}, 5000);
setInterval(() => {
  if (!siteOpen || !connected || nativeBusy) return;
  void nativeCall('sampleSite')
    .then((sample: Sample) => {
      siteSample = sample;
      if (!room?.media || !sample.available || !sample.action || sample.seq === undefined) return;
      if (sample.frame !== remoteFrame) {
        remoteFrame = sample.frame ?? '';
        lastRemoteSeq = sample.seq;
        return;
      }
      if (sample.seq <= lastRemoteSeq) return;
      lastRemoteSeq = sample.seq;
      if (sample.action === 'ended') {
        if (sample.position !== undefined && sample.duration)
          send({
            type: 'ended',
            mediaId: room.media.id,
            epoch: room.epoch,
            position: sample.position,
            duration: sample.duration,
          });
      } else if (sample.action === 'seek') control('seek', { position: sample.position! });
      else if (sample.action === 'rate') control('rate', { rate: sample.rate! });
      else control(sample.action);
    })
    .catch(error);
}, 700);
void cache.sweep().catch(error);
render();
