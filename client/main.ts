import type Hls from 'hls.js';
import './style.css';
import { icon } from './icons';
import { PlaybackPicker, playbackPickerMarkup } from './playback-picker';
import type { ClientMessage, MediaInput, ServerMessage, Snapshot } from '../shared/protocol';
import { PROTOCOL, parseInvite, serverOrigin, invitationServer } from '../shared/invite';
import { describeUrl } from '../shared/sites';
import { positionAt, reconcile } from '../shared/sync';
import { DeviceCache } from './cache';
import { RoomPeers } from './peers';
import { setupUpdates } from './updates';
import { BroadcastPeers } from './broadcast';
import { BroadcastRelayClient } from './broadcast-relay';
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
<header class="topbar"><a class="brand" href="#" aria-label="VideoSreeeen 首页"><span class="brand-mark">${icon('film', 24)}</span><span>Video<span class="brand-light">Sreeeen</span><small>多人同步观影</small></span></a><div class="top-actions"><span id="connection" class="connection"><i></i>尚未连接</span><span id="platform" class="platform"></span><button id="web-entry" class="button soft small" hidden>打开网页版</button>${button('settings-button', '设置与帮助', 'settings')}<button id="room-button" class="button accent small">${icon('plus', 17)} 创建 / 加入房间</button></div></header>
<main class="workspace"><section class="screen-column"><div class="room-heading"><div><div class="eyebrow">YOUR SHARED SCREEN</div><h1 id="room-title">多人观影<span class="orange-dot">.</span></h1><p id="room-subtitle">创建房间或通过邀请加入。</p></div><div class="heading-actions">${button('invite-button', '复制房间邀请', 'link')}${button('chat-toggle', '隐藏或显示聊天室', 'chat')}</div></div>
<section id="stage" class="stage"><div id="welcome" class="welcome"><div class="scene-lines"></div><div class="scene-orb"></div><div class="frame-index">V / S <span>PRIVATE CINEMA</span></div><div class="welcome-text"><span class="tag">链接 · 画面 · 本地视频</span><h2>选择视频，<br>开始同步观看。</h2><p>支持视频链接、实时画面和本地文件。</p><div class="hero-actions"><button id="hero-create" class="button accent">${icon('plus', 18)} 创建房间 ${icon('arrow', 17)}</button><button id="hero-join" class="text-button">通过邀请加入 →</button></div></div><div class="scene-footer"><span>PLAY · SYNC · SHARE</span><span>01 — ∞</span></div></div><video id="video" playsinline preload="metadata" hidden></video><audio id="audio" preload="metadata"></audio><div id="native-stage" class="native-stage" hidden><div class="native-hint">正在客户端内打开原站…</div></div><div id="browser-hint" class="browser-hint" hidden>${icon('globe', 36)}<h3 id="browser-title">选择播放方式</h3><p id="browser-description"></p><div class="browser-actions"><button id="browser-provide" class="button accent">提供视频给房间</button><button id="browser-takeover" class="button outline" hidden>改由我提供视频</button><button id="browser-local-video" class="button soft" title="选择本机视频，实时传给房间成员">打开视频文件</button></div><div class="browser-secondary"><button id="browser-invite" class="text-button" title="客户端成员也可识别视频源，或共享原站画面">邀请成员提供视频</button><button id="browser-help" class="text-button">使用方法</button></div></div><div id="cache-overlay" class="cache-overlay" hidden><span class="cache-icon">${icon('download', 28)}</span><h3 id="cache-title">等待完整缓存</h3><p id="cache-description">每人完整缓存，等最慢的朋友准备好。</p><div class="cache-track"><i id="cache-progress"></i></div><button id="cache-button" class="button accent">开始本机缓存</button></div></section>
<div class="transport"><button id="play-button" class="play-button" title="播放或暂停" aria-label="播放或暂停">${icon('play', 19)}</button><button id="live-sound" class="icon-button" title="静音" aria-label="静音" hidden>${icon('volume', 19)}</button><span id="position" class="time">00:00</span><input id="seek" aria-label="播放进度" type="range" min="0" max="100" step="0.1" value="0"><span id="duration" class="time muted">00:00</span><select id="rate" aria-label="播放速度"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>${button('fullscreen', '全屏', 'expand')}</div>
${playbackPickerMarkup}
<details id="cache-options" class="cache-options"><summary title="默认关闭。只有大家都卡时才考虑完整缓存；实时画面不使用此模式。">共同缓存</summary><section class="mode-card"><div class="mode-copy"><span class="mode-symbol">${icon('download', 22)}</span><div><h3>共同缓存模式 <span class="pill">手动启用</span></h3><p id="mode-description">仅在大家都卡时使用；默认边播边看。</p></div></div><button id="mode-toggle" class="switch" role="switch" aria-checked="false" aria-label="共同缓存模式"><i></i></button></section></details><div class="screen-foot"><span id="control-summary">${icon('shield', 14)} 多人可控 · 自动同步</span><span id="sync-status">等待加入房间</span></div>
</section>
<aside id="sidebar" class="sidebar"><section class="members-card"><div class="section-heading"><span>${icon('users', 18)} 放映室成员 <b id="member-count">0</b></span><span class="live-label">${icon('signal', 14)} RTT</span></div><div id="members" class="members"><p class="empty-members">暂无成员</p></div><button id="sidebar-invite" class="invite-line">${icon('plus', 16)} 邀请成员</button></section><section id="chat-panel" class="chat-panel"><div id="chat-drag" class="chat-heading" title="拖拽可悬浮聊天室"><div>${icon('chat', 18)} 聊天室 <span class="tiny-dot"></span></div><div>${button('chat-dock', '停靠聊天室', 'expand')}</div></div><div id="chat-messages" class="chat-messages"><div id="chat-empty" class="chat-empty"><span>${icon('chat', 30)}</span><p>暂无消息</p><small>加入房间后，消息会出现在这里。</small></div></div><div id="emoji-picker" class="emoji-picker" hidden></div><div class="chat-compose"><textarea id="chat-input" title="Enter 发送，Shift + Enter 换行" aria-label="聊天消息" placeholder="发送消息…" rows="2" maxlength="2000"></textarea><div class="compose-actions"><div>${button('emoji-button', '选择表情', 'smile')}${button('image-button', '发送图片或 GIF 表情包', 'image')}<input id="image-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden></div><button id="send-button" class="send-button" title="发送消息" aria-label="发送消息">${icon('send', 17)}</button></div></div></section><div class="sidebar-foot">VIDEOSREEEEN <span>✳</span></div></aside></main>
<footer class="app-foot"><span>VideoSreeeen <b>0.4.0</b></span><span>GPL-3.0 · 开源</span><button id="leave-button" class="text-button" hidden>${icon('exit', 14)} 离开放映室</button></footer>
<dialog id="room-dialog" aria-labelledby="room-dialog-title"><form id="room-form"><div class="dialog-heading"><div><div class="eyebrow">ROOM</div><h2 id="room-dialog-title">创建或加入房间</h2></div><button id="dialog-close" type="button" class="icon-button" aria-label="关闭">${icon('close')}</button></div><div class="room-tabs" role="group" aria-label="创建或加入"><button id="create-tab" type="button" aria-pressed="true">创建房间</button><button id="join-tab" type="button" aria-pressed="false">我有邀请</button></div><label>你的昵称<input id="name-input" maxlength="30" autocomplete="nickname" placeholder="输入昵称" required></label><div id="invite-field" hidden><label>朋友的邀请链接或完整邀请码<input id="invite-input" autocomplete="off" spellcheck="false" placeholder="粘贴朋友发来的邀请"></label><p id="invite-server-hint" class="dialog-note">推荐使用完整链接，可自动找到朋友的房间。</p></div><p id="create-note" hidden></p><div class="dialog-buttons"><button id="create-button" type="submit" class="button accent">创建房间并生成邀请</button><button id="join-button" type="submit" class="button accent" hidden>加入朋友的房间</button></div><p id="dialog-error" class="form-error" role="alert"></p></form></dialog>
<dialog id="invite-dialog" aria-labelledby="invite-title"><div class="dialog-heading"><div><div class="eyebrow">INVITE</div><h2 id="invite-title">邀请成员</h2></div><button data-close="invite-dialog" class="icon-button" aria-label="关闭">${icon('close')}</button></div><p class="dialog-copy">朋友打开链接，填个昵称就能加入。苹果设备直接用浏览器。</p><label>邀请链接<input id="invite-link" readonly aria-label="邀请链接"></label><div class="dialog-buttons"><button id="copy-link" class="button accent">${icon('copy', 16)} 复制邀请链接</button><button id="share-invite" class="button outline" hidden>系统分享</button></div><details class="advanced"><summary>使用邀请码加入</summary><label>完整邀请码<input id="invite-code" readonly></label><button id="copy-code" class="text-button">复制邀请码</button><p class="dialog-note">邀请码只适用于相同服务器；跨服务器请发送完整邀请链接。不要只发送六位房间号。</p></details><p id="invite-feedback" class="form-error" role="status"></p><button data-close="invite-dialog" class="button soft dialog-wide">继续选片</button></dialog>
<dialog id="settings-dialog" aria-labelledby="settings-title"><form id="settings-form"><div class="dialog-heading"><div><div class="eyebrow">SETTINGS</div><h2 id="settings-title">设置与帮助</h2></div><button type="button" data-close="settings-dialog" class="icon-button" aria-label="关闭">${icon('close')}</button></div><details class="advanced"><summary>版本与更新</summary><p class="dialog-note">Windows / Android 0.4.0</p><div class="dialog-buttons"><button id="update-action" type="button" class="button soft">检查更新</button><a class="button soft" href="https://github.com/BorderArea01/VideoSreeeen/releases/latest/download/VideoSreeeen-Setup.exe" target="_blank" rel="noopener noreferrer">Windows 安装版</a><a class="button soft" href="https://github.com/BorderArea01/VideoSreeeen/releases/latest/download/VideoSreeeen-Android.apk" target="_blank" rel="noopener noreferrer">Android APK</a></div><p id="update-status" class="dialog-note" role="status"></p></details><details id="connection-details" class="advanced"><summary>高级 · 房间服务器</summary><p class="dialog-note">仅自建或局域网用户需要修改。保存后用于下一次建房或邀请码加入，不会切换当前房间。</p><label>服务器地址<input id="server-input" type="url" placeholder="https://你的服务器" required></label><div class="dialog-buttons"><button type="submit" class="button accent">保存设置</button><button id="reset-server" type="button" class="button outline">恢复默认</button></div><p id="settings-error" class="form-error" role="alert"></p><p id="settings-status" class="dialog-note" role="status"></p></details><details id="watch-help" class="advanced"><summary>第一次使用 · 怎么一起看？</summary><ol class="help-steps"><li>创建房间，把邀请链接发给朋友；朋友打开后填写昵称即可加入。</li><li>视频直链可直接同步播放；原站链接会显示可用的播放方式。</li><li>电脑浏览器在“提供视频给房间”窗口完成两步：打开原站播放，再选择该标签页并勾选音频。完成后房间才会显示画面；原站负责播放进度。Windows 客户端也可共享原站画面，或识别视频源以使用同步播放、暂停和拖动。</li><li>默认边播边看。仅在大家都卡时，可手动开启共同缓存，完整下载后播放。</li></ol></details><details class="advanced"><summary>浏览器与客户端有什么区别？</summary><p class="dialog-note">浏览器可建房、聊天、看直链、共享本地文件和接收画面；支持屏幕共享的电脑浏览器还可提供视频标签页。网页不能自动读取第三方网站的播放器。浏览器完整缓存目前限总计 128 MiB；长视频缓存请用客户端。Windows / Android 可在应用内打开原站，苹果设备使用浏览器。</p></details><div class="help-links"><button id="project-link" type="button" class="text-button">开源项目与构建说明 ↗</button><button id="feedback-link" type="button" class="text-button">反馈问题 ↗</button></div><p class="dialog-note">GPL-3.0 · 无需注册。昵称会保存在本机；房间服务会处理昵称、聊天和同步信息。公共服务可能受免费额度或网络影响，也可以自行部署。</p><button data-close="settings-dialog" type="button" class="button soft dialog-wide">返回观影</button></form></dialog><div id="toast" class="toast" role="status" hidden></div>`;

$('platform').textContent = platform;
const playbackPicker = new PlaybackPicker();
$('link-capability').textContent = isNative
  ? '每人独立加载视频，只同步进度，画质不经转码。支持视频直链和客户端内的原站播放器；原站需要各自登录。'
  : '每人独立加载视频，只同步进度，画质不经转码。支持 MP4 / WebM / HLS 直链；B 站等原站页面需客户端，或改用共享画面。';
$('site-source-options').hidden = !isNative;
if (isNative) {
  $<HTMLInputElement>('source-url').placeholder = '粘贴视频直链或原站页面地址';
  $('screen-open-note').textContent = window.desktop
    ? '在客户端原站中播放后，点击“共享客户端原站画面”。'
    : 'Android 可以同步原站播放器、接收画面或提供本地视频；当前不支持原站画面采集。';
  if (window.desktop) $<HTMLDetailsElement>('screen-open-details').open = true;
}
$('stop-broadcast').insertAdjacentHTML(
  'beforebegin',
  '<select id="broadcast-quality" aria-label="共享画质" title="提供者设置，影响全房间；网络不稳可选流畅" hidden><option value="smooth">流畅</option><option value="hd" selected>高清</option><option value="high">高画质</option></select>',
);
$('app').insertAdjacentHTML(
  'beforeend',
  '<dialog id="image-dialog" class="image-viewer"><button class="icon-button" data-close="image-dialog" aria-label="关闭图片">×</button><img id="image-full" alt="聊天原图"></dialog>',
);
document.addEventListener('click', (event) => {
  const link = (event.target as Element)?.closest<HTMLAnchorElement>('a[target="_blank"]');
  if (link && !event.defaultPrevented && isNative) {
    event.preventDefault();
    void nativeCall('openBrowser', { url: link.href }).catch(error);
  }
});
$('app').insertAdjacentHTML(
  'beforeend',
  `
<dialog id="provide-dialog" aria-labelledby="provide-title">
  <div class="dialog-heading"><h2 id="provide-title">提供视频给房间</h2><button data-close="provide-dialog" class="icon-button" aria-label="关闭">${icon('close')}</button></div>
  <p class="dialog-copy">完成共享后，观众会直接在房间里看到画面和声音。</p>
  <div id="provide-steps" class="provide-steps">
    <button id="browser-open-site" class="button outline">1 · 打开原站，播放视频</button>
    <p class="dialog-note">播放后回到这个窗口，继续下一步。</p>
    <button id="browser-share-tab" class="button accent">2 · 选择视频标签页，开始提供</button>
    <p class="dialog-note">选择刚才打开的原站标签页，并勾选共享音频。</p>
  </div>
  <p id="provide-unavailable" class="dialog-note" hidden>这个浏览器不能提供标签页画面。可以选择本地视频，或由电脑成员提供。</p>
  <p id="provide-status" class="provide-status" role="status">尚未开始共享</p>
  <button id="provide-local-video" class="button soft dialog-wide">改用本地视频</button>
</dialog>`,
);
$('stage').insertAdjacentHTML(
  'beforeend',
  '<div id="live-status" class="live-status" role="status" hidden></div>',
);
$('watch-help').insertAdjacentHTML(
  'beforebegin',
  `
<details id="video-diagnostics" class="advanced"><summary>高级 · 视频连接诊断</summary>
<p class="dialog-note">跨网黑屏时可复制双方的连接状态。内容不含房间密钥、视频地址或 IP。</p>
<button id="copy-video-diagnostics" type="button" class="button soft">复制连接诊断</button>
<p id="video-diagnostics-status" class="dialog-note" role="status"></p>
<textarea id="video-diagnostics-output" aria-label="连接诊断" rows="7" readonly spellcheck="false" hidden></textarea></details>`,
);
$('web-entry').hidden = !window.desktop;
$('web-entry').onclick = () => {
  void nativeCall('openBrowser', {
    url: activeServer || configuredServer,
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
let configuredServer = saved('server') || defaultServer;
$<HTMLInputElement>('server-input').value = configuredServer;
$<HTMLInputElement>('name-input').value = saved('name');
function inviteFromLocation() {
  if (!parseInvite(location.hash.slice(1))) return '';
  return /^https?:$/.test(location.protocol) && location.hostname !== 'videosreeeen.local'
    ? `${location.origin}/${location.hash}`
    : location.hash.slice(1);
}
const initialInvite = inviteFromLocation();
if (initialInvite) $<HTMLInputElement>('invite-input').value = initialInvite;
if (window.desktop && !saved('server') && !publicServer)
  void nativeCall('serverInfo')
    .then((info) => {
      if (info?.share) $<HTMLInputElement>('server-input').value = configuredServer = info.share;
    })
    .catch(error);
let ws: WebSocket | null = null,
  room: Snapshot | null = null,
  memberId = '',
  resume = '',
  activeServer = '',
  sessionName = '',
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let desiredSession = false,
  connected = false,
  retries = 0,
  anchoredAt = 0,
  rtt: number | null = null;
let mediaRelay = true;
let sourceFailed = false;
let playbackPermissionNeeded = false;
let liveMuted = false;
let autoSharedMedia = '';
let requestedScreenPage = '';
let publisher: HTMLVideoElement | null = null;
let publisherStream: MediaStream | null = null;
let providingMediaId = '',
  provideDialogMediaId = '',
  openedSourceMediaId = '';
let provideError = '';
let publisherUrl = '';
let publisherCleanup: (() => void) | null = null;
let pendingBroadcastUrl = '';
let broadcastBusy = false;
let stoppingBroadcast = false;
let nativeCapture = false,
  captureEnding: Promise<unknown> = Promise.resolve();
let broadcastMessage = '';
let broadcastRelayEnabled = false;
let relayPlaybackUrl = '';
let clearing: Promise<void> = Promise.resolve();
let clearingBusy = false,
  clearingTicket = 0;
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
  // Screen capture has no access to the source player's timeline or controls.
  if (room?.media?.broadcast?.kind === 'screen' || hasPendingPreview()) return;
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
let roomIntent: 'create' | 'join' = 'create';
let connecting = false;
function showDialog(id: string) {
  for (const other of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) other.close();
  void hideSite(true);
  $<HTMLDialogElement>(id).showModal();
}
function updateInviteHint() {
  const input = $<HTMLInputElement>('invite-input').value;
  try {
    const origin = invitationServer(input, configuredServer);
    $('invite-server-hint').textContent = `将加入 ${new URL(origin).host} 上的房间`;
  } catch {
    $('invite-server-hint').textContent = '请粘贴完整邀请链接或邀请码；六位房间号不能单独加入。';
  }
}
function setRoomIntent(intent: 'create' | 'join') {
  roomIntent = intent;
  for (const kind of ['create', 'join']) {
    $(`${kind}-tab`).setAttribute('aria-pressed', String(kind === intent));
    $(`${kind}-button`).hidden = kind !== intent;
  }
  $('invite-field').hidden = intent !== 'join';
  $('create-note').hidden = intent !== 'create';
  $<HTMLInputElement>('invite-input').required = intent === 'join';
  $('dialog-error').textContent = '';
  if (intent === 'join') updateInviteHint();
}
function openDialog(intent: 'create' | 'join' = 'create') {
  setRoomIntent(intent);
  showDialog('room-dialog');
}
function closeDialog() {
  dialog.close();
  void resizeSite();
}
async function connect(kind: 'create' | 'join', reconnect = false) {
  const name = reconnect ? sessionName : $<HTMLInputElement>('name-input').value.trim();
  if (!name) throw new Error('请填写昵称');
  const invite = reconnect && room ? room.invite : $<HTMLInputElement>('invite-input').value.trim();
  const server = new URL(
    reconnect
      ? activeServer
      : kind === 'join'
        ? invitationServer(invite, configuredServer)
        : serverOrigin(configuredServer),
  );
  if (location.protocol === 'https:' && !isNative && server.protocol !== 'https:')
    throw new Error('HTTPS 页面需要连接 HTTPS 服务器');
  activeServer = server.origin;
  sessionName = name;
  save('name', name);
  desiredSession = true;
  if (!reconnect) {
    releasePublisher();
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
  broadcastRelayEnabled = false;
  let roomRouting = false;
  try {
    const response = await fetch(activeServer + '/config', { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const config = await response.json();
      mediaRelay = config.mediaRelay !== false;
      roomRouting = config.roomRouting === true;
      broadcastRelayEnabled = config.broadcastRelay === true;
      peers.setIceServers(
        Array.isArray(config.iceServers) ? config.iceServers : [],
        config.p2p === true,
      );
      broadcast.setIceServers(Array.isArray(config.iceServers) ? config.iceServers : []);
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
          stoppingBroadcast = false;
          const rejectedBroadcastUrl = pendingBroadcastUrl;
          if (message.room) adopt(message.room);
          if (rejectedBroadcastUrl && room?.media?.url !== rejectedBroadcastUrl) {
            releasePublisher();
            provideError = message.message;
            render();
          }
          if (!welcomed) {
            clearTimeout(timeout);
            desiredSession = false;
            reject(new Error(message.message));
            socket.close();
          } else toast(message.message);
        } else if (message.type === 'pong') rtt = Math.max(0, performance.now() - message.sentAt);
        else if (message.type === 'probe') send({ type: 'probe', nonce: message.nonce });
        else if (message.type === 'signal') {
          if (message.purpose === 'broadcast') broadcast.receive(message);
          else peers.receive(message);
        } else if (
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
      if (pendingBroadcastUrl) {
        pendingBroadcastUrl = '';
        releasePublisher();
        provideError = '房间连接中断，尚未完成共享，请重新操作';
      }
      peers.close();
      broadcast.close();
      broadcastFallback.close();
      publisher?.pause();
      pendingControl = false;
      connectionView('连接已断开');
      video.pause();
      audio.pause();
      render();
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
    if (
      !snapshot.media?.broadcast ||
      snapshot.media.broadcast.host !== memberId ||
      !broadcast.owns(snapshot.media.url)
    )
      releasePublisher();
    const keepSite =
      isNative &&
      siteOpen &&
      previous?.mode === 'stream' &&
      snapshot.mode === 'stream' &&
      previous.media?.url === snapshot.media?.url &&
      (!!snapshot.media?.source || snapshot.media?.broadcast?.kind === 'site') &&
      (!snapshot.media?.broadcast || snapshot.media.broadcast.host === memberId) &&
      snapshot.media?.provider !== 'direct';
    sourceFailed = false;
    cacheContext = null;
    cleanupState = 'idle';
    clearingBusy = true;
    const ticket = ++clearingTicket;
    const keepPreview =
      snapshot.mode === 'stream' &&
      snapshot.media?.broadcast?.host === memberId &&
      snapshot.media.broadcast.kind !== 'site' &&
      !!publisherStream &&
      video.srcObject === publisherStream &&
      broadcast.owns(snapshot.media.url);
    clearing = clearPlayback(keepSite, keepPreview);
    void clearing
      .finally(() => {
        if (clearingTicket === ticket) {
          clearingBusy = false;
          render();
        }
      })
      .catch(error);
    lastRevision = -1;
    lastRemoteSeq = -1;
    remoteFrame = '';
  }
  room = snapshot;
  // Accept offers immediately. Native file cleanup may finish after signaling
  // has already arrived; starting a new download still awaits `clearing`.
  peers.configure(room, memberId);
  configureBroadcast();
  if (
    !changed &&
    snapshot.media?.broadcast?.host === memberId &&
    snapshot.media.broadcast.kind !== 'site' &&
    publisherStream &&
    broadcast.owns(snapshot.media.url) &&
    video.srcObject !== publisherStream
  ) {
    video.srcObject = publisherStream;
    video.muted = true;
    video.hidden = false;
    if (!snapshot.playback.paused) playElement(video);
  }
  if (pendingBroadcastUrl === snapshot.media?.url && snapshot.media.broadcast?.host === memberId)
    pendingBroadcastUrl = '';
  if (changed) void clearing.catch(error);
  anchoredAt = performance.now() - snapshot.playbackAgeMs - (rtt ?? 0) / 2;
  render();
  if (changed) {
    if (
      !isNative &&
      snapshot.media &&
      !snapshot.media.source &&
      !snapshot.media.broadcast &&
      snapshot.media.sharedBy === memberId
    )
      openProvider();
    else closeProvider();
  }
  if (
    snapshot.media &&
    snapshot.mode === 'stream' &&
    (loadedMedia !== snapshot.media.id || loadedKind === 'cache')
  )
    void loadStream(snapshot.media);
  if (!previous || changed || previous.playback.revision !== snapshot.playback.revision)
    applyPlayback(true);
}
function openProvider() {
  if (!room?.media || room.media.broadcast || isNative) return;
  playbackPicker.select('screen');
  providingMediaId = room.media.id;
  provideDialogMediaId = room.media.id;
  provideError = '';
  render();
  showDialog('provide-dialog');
}
function closeProvider() {
  $<HTMLDialogElement>('provide-dialog').close();
  provideDialogMediaId = '';
  provideError = '';
}
function hasPendingPreview() {
  return !!pendingBroadcastUrl && !!publisherStream?.active && video.srcObject === publisherStream;
}
function showPublisherPreview(stream: MediaStream) {
  if (video.srcObject !== stream) {
    playerGeneration++;
    hls?.destroy();
    hls = null;
    video.removeAttribute('src');
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    video.srcObject = stream;
  }
  video.muted = true;
  video.hidden = false;
  $('browser-hint').hidden = true;
  $('native-stage').hidden = true;
  playElement(video);
}
const playRequests = new WeakMap<
  HTMLMediaElement,
  {
    generation: number;
    source: string | null;
    stream: HTMLMediaElement['srcObject'];
  }
>();
function playElement(element: HTMLMediaElement) {
  const generation = playerGeneration;
  const source = element.getAttribute('src');
  const stream = element.srcObject;
  const pending = playRequests.get(element);
  if (pending?.generation === generation && pending.source === source && pending.stream === stream)
    return;
  const request = { generation, source, stream };
  playRequests.set(element, request);
  const current = () =>
    generation === playerGeneration &&
    element.srcObject === stream &&
    element.getAttribute('src') === source;
  void element
    .play()
    .then(() => {
      if (
        current() &&
        playbackPermissionNeeded &&
        !video.paused &&
        (!audio.src || !audio.paused) &&
        (!publisher || !publisher.paused)
      ) {
        playbackPermissionNeeded = false;
        render();
      }
    })
    .catch((cause) => {
      // Playback promises belong to the input that started them. Source changes
      // and pause/load cancellations must not mark the replacement as blocked.
      if (!current() || cause?.name === 'AbortError') return;
      if (cause?.name === 'NotAllowedError') {
        playbackPermissionNeeded = true;
        render();
      } else error(cause);
    })
    .finally(() => {
      if (playRequests.get(element) === request) playRequests.delete(element);
    });
}
function renderLiveSound() {
  const button = $('live-sound');
  const label = playbackPermissionNeeded ? '启用声音' : liveMuted ? '取消静音' : '静音';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(liveMuted));
  button.innerHTML = icon(liveMuted || playbackPermissionNeeded ? 'volume-off' : 'volume', 19);
}
function renderLiveStatus() {
  const sharing = room?.media?.broadcast;
  const badge = $('live-status');
  badge.title = '';
  const preview = hasPendingPreview();
  badge.hidden = !sharing && !preview;
  if (preview) {
    badge.textContent = '本机预览 · 正在建立房间共享';
    $('broadcast-status').textContent = badge.textContent;
    return;
  }
  if (!sharing) return;
  if (!connected) {
    badge.textContent = '房间连接已断开，正在恢复';
    $('broadcast-status').textContent = badge.textContent;
    return;
  }
  let text: string;
  if (sharing.host === memberId) {
    const { expected, connected, failed } = broadcast.viewers();
    text = !expected
      ? '正在提供视频 · 暂无观众'
      : connected === expected
        ? `正在提供视频 · 已连接 ${connected} 位观众`
        : `正在提供视频 · 已连接 ${connected} / ${expected} 位观众`;
    const relayStatus = broadcastFallback.status();
    if (broadcastRelayEnabled) text = relayStatus;
    else if (failed) text += ' · 连接失败，正在重试';
    if (!room?.media || !broadcast.owns(room.media.url)) text = '共享已中断，请重新选择视频';
    if (publisherStream && !publisherStream.getAudioTracks().length) text += ' · 未共享音频';
    $('broadcast-status').textContent = text;
  } else {
    const name = room?.members.find((member) => member.id === sharing.host)?.name ?? '成员';
    const reception = broadcast.reception();
    badge.title = broadcastRelayEnabled
      ? '通过服务器转发视频，使用短暂缓冲抵御网络波动。'
      : !reception.hasTurn
        ? '当前没有配置视频中继；如果双方网络无法直连，需要部署中继或改用各自播放。'
        : '';
    if (reception.state === 'offline') text = '共享者已离线，等待重新连接';
    else if (broadcastFallback.active() && playbackPermissionNeeded)
      text = sharing.kind === 'screen' ? '点击声音按钮开始观看' : '点击播放以启用声音';
    else if (broadcastFallback.active() && room?.playback.paused) text = '房间已暂停播放';
    else if (broadcastFallback.status()) text = broadcastFallback.status();
    else if (['failed', 'closed', 'disconnected'].includes(reception.state))
      text = '共享已开始 · 视频连接失败，正在重试' + (reception.hasTurn ? '' : ' · 当前未配置中继');
    else if (playbackPermissionNeeded)
      text = sharing.kind === 'screen' ? '点击声音按钮开始观看' : '点击播放以启用声音';
    else if (reception.state !== 'connected') text = `共享已开始 · 正在连接 ${name}`;
    else if (room?.playback.paused) text = '房间已暂停播放';
    else if (video.srcObject && video.videoWidth > 0 && video.readyState >= 2)
      text = `正在接收 ${name} 的视频`;
    else text = '共享已开始 · 连接已建立，等待视频画面';
  }
  badge.textContent = text;
  $('broadcast-status').textContent = text;
  $('provide-status').textContent = text;
}
function render() {
  if (provideDialogMediaId && provideDialogMediaId !== room?.media?.id) closeProvider();
  const joined = !!room;
  const preview = hasPendingPreview();
  const sourceNeeded = !isNative && !!room?.media && !room.media.source && !room.media.broadcast;
  const blocked = !preview && (sourceNeeded || sourceFailed);
  const liveScreen = room?.media?.broadcast?.kind === 'screen' || preview;
  for (const id of ['play-button', 'position', 'seek', 'duration', 'rate'])
    $(id).hidden = liveScreen;
  $('live-sound').hidden = !liveScreen || preview || room?.media?.broadcast?.host === memberId;
  renderLiveSound();
  const canShareTab = !isNative && !!navigator.mediaDevices?.getDisplayMedia;
  const media = room?.media;
  const actualChoice =
    media?.broadcast?.kind === 'file'
      ? 'file'
      : media?.broadcast
        ? 'screen'
        : requestedScreenPage === media?.url
          ? 'screen'
          : 'link';
  playbackPicker.observe(
    media ? `${media.url}:${media.broadcast?.kind ?? 'source'}` : '',
    actualChoice,
  );
  if (requestedScreenPage === media?.url) requestedScreenPage = '';
  $('current-playback').textContent = !media
    ? '尚未选择视频'
    : media.broadcast?.kind === 'file'
      ? '当前：本地视频'
      : media.broadcast
        ? '当前：共享画面'
        : sourceNeeded
          ? '原站链接 · 尚未提供画面'
          : sourceFailed
            ? '共同播放 · 视频未就绪'
            : room?.mode === 'cache'
              ? '当前：共同播放 · 共同缓存'
              : '当前：共同播放';
  $('active-source').hidden = !media;
  $('control-summary').innerHTML =
    `${icon('shield', 14)} ${media?.broadcast?.kind === 'screen' ? '共享画面 · 原站控制进度' : '多人可控 · 自动同步'}`;
  $('screen-unavailable').hidden = canShareTab || !!window.desktop;
  $('screen-open-details').hidden = !canShareTab && !isNative;
  const providing = room?.media?.sharedBy === memberId || providingMediaId === room?.media?.id;
  const sourceMember = room?.members.find((m) => m.id === room?.media?.sharedBy);
  const cacheAvailable =
    !!room?.media?.source &&
    !room.media.broadcast &&
    (isNative || room.media.source.kind !== 'hls');
  $('cache-options').hidden = !cacheAvailable && room?.mode !== 'cache';
  $('browser-hint').hidden = !blocked || room?.mode === 'cache';
  $('browser-title').textContent = sourceNeeded
    ? providing
      ? '将视频提供给房间'
      : `等待「${sourceMember?.name ?? '成员'}」开始共享`
    : '当前视频地址无法直接播放';
  $('browser-description').textContent = sourceNeeded
    ? providing
      ? '完成共享后，房间成员才能看到视频。'
      : '此原站页面需客户端内的播放器。也可由成员共享画面，浏览器观众无需打开原站。'
    : '地址可能已失效，或视频源限制外部播放。可以换一个视频直链，或改用共享画面。';

  $<HTMLButtonElement>('play-button').disabled = !room?.media || blocked || preview;
  for (const id of ['play-button', 'position', 'seek', 'duration', 'rate'])
    $(id).hidden = liveScreen || !media || blocked;
  $<HTMLButtonElement>('mode-toggle').disabled = !cacheAvailable;
  $('broadcast-site').hidden = !window.desktop || !siteOpen || !!room?.media?.broadcast;
  $('broadcast-screen').hidden = !canShareTab;
  $('browser-provide').hidden = room?.media?.provider === 'direct' || (sourceNeeded && !providing);
  $('browser-takeover').hidden = !sourceNeeded || providing;
  $('browser-local-video').hidden = sourceNeeded && !providing;
  $('browser-invite').hidden = sourceNeeded && !providing;
  $('provide-steps').hidden = !canShareTab;
  $('provide-unavailable').hidden = canShareTab;
  $('provide-status').textContent = !connected
    ? '房间连接已断开，恢复后再开始共享'
    : provideError ||
      (pendingBroadcastUrl
        ? '已选择视频，正在通知房间…'
        : broadcastBusy
          ? '正在准备共享内容…'
          : openedSourceMediaId === room?.media?.id
            ? '尚未开始共享 · 返回后请完成第 2 步'
            : '尚未开始共享');
  $<HTMLButtonElement>('browser-share-tab').disabled =
    !connected || broadcastBusy || !!pendingBroadcastUrl;
  $<HTMLButtonElement>('browser-local-video').disabled =
    !connected || broadcastBusy || !!pendingBroadcastUrl;
  $<HTMLButtonElement>('provide-local-video').disabled =
    !connected || broadcastBusy || !!pendingBroadcastUrl;
  $('stop-broadcast').hidden = room?.media?.broadcast?.host !== memberId;
  $('broadcast-quality').hidden =
    !broadcastRelayEnabled || room?.media?.broadcast?.host !== memberId;
  $('broadcast-status').textContent = playbackPermissionNeeded
    ? '点击播放以启用声音'
    : room?.media?.broadcast
      ? broadcastMessage ||
        (room.media.broadcast.host === memberId ? '正在提供实时画面' : '正在连接视频提供者')
      : '';
  renderLiveStatus();
  $<HTMLButtonElement>('local-video-button').disabled =
    !joined || broadcastBusy || !!pendingBroadcastUrl;
  $<HTMLButtonElement>('broadcast-site').disabled =
    !joined || broadcastBusy || !!pendingBroadcastUrl || !siteSample?.available;
  $<HTMLButtonElement>('broadcast-screen').disabled =
    !joined || broadcastBusy || !!pendingBroadcastUrl;
  $<HTMLInputElement>('seek').disabled =
    blocked || preview || room?.media?.broadcast?.kind === 'screen';
  $<HTMLSelectElement>('rate').disabled =
    blocked || preview || room?.media?.broadcast?.kind === 'screen';
  $('cache-options').classList.toggle('active', !!(room?.mode === 'cache'));
  if (!room?.media) {
    $('sync-status').textContent = '等待加入房间';
    $('position').textContent = $('duration').textContent = '00:00';
    $<HTMLInputElement>('seek').value = '0';
  }
  $('hero-create').innerHTML = joined
    ? `${icon('film', 18)} 选择视频 ${icon('arrow', 17)}`
    : `${icon('plus', 18)} 创建房间 ${icon('arrow', 17)}`;
  $('hero-join').textContent = joined ? '邀请成员 →' : '通过邀请加入 →';
  $('room-title').textContent = room ? (room.media?.title ?? `放映室 ${room.code}`) : '多人观影。';
  $('room-subtitle').textContent = room
    ? `${room.code} · ${room.members.filter((m) => m.online).length} 人在线`
    : '创建房间或通过邀请加入。';
  $('room-button').innerHTML = joined
    ? `${icon('link', 16)} 邀请成员`
    : `${icon('plus', 17)} 创建 / 加入房间`;
  $('provider').textContent = room?.media
    ? {
        bilibili: '哔哩哔哩',
        xifan: '喜番',
        mgn: '蜜柑',
        direct: '视频直链',
        other: '其他网站',
        local: '本地视频',
      }[room.media.provider]
    : '选择播放方式';
  $('leave-button').hidden = !joined;
  $('member-count').textContent = String(room?.members.length ?? 0);
  const members = $('members');
  members.replaceChildren();
  if (!room) {
    const p = document.createElement('p');
    p.className = 'empty-members';
    p.textContent = '暂无成员';
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
      : '仅在大家都卡时使用；默认边播边看。';
  const mine = room?.members.find((m) => m.id === memberId)?.cache;
  const needsCache = !!caching && (!room?.cacheReady || loadedKind !== 'cache');
  $('cache-overlay').hidden = !needsCache || preview;
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
        : '等待完整缓存';
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
    clearingBusy || cacheStartBusy || mine?.state === 'downloading' || mine?.state === 'ready';
  $('cache-button').textContent = room?.finished
    ? '重新准备这一部'
    : mine?.state === 'ready'
      ? '等待全员就绪'
      : clearingBusy
        ? '正在准备缓存…'
        : mine?.state === 'downloading'
          ? '正在下载…'
          : '开始本机缓存';
  $('extract-button').hidden =
    !isNative || !room?.media || room.media.provider === 'direct' || caching;
  $('welcome').hidden = !!room?.media || preview;
  $('stage').classList.toggle('lobby-stage', !room?.media && !preview);
  $('play-button').innerHTML = icon(
    playbackPermissionNeeded || room?.playback.paused !== false ? 'play' : 'pause',
    19,
  );
  $<HTMLSelectElement>('rate').value = String(room?.playback.rate ?? 1);
  if (caching && !room?.cacheReady && !preview) {
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
    empty.innerHTML = `<span>${icon('chat', 30)}</span><p>暂无消息</p><small>${room ? '发送文字、图片或表情。' : '加入房间后，消息会出现在这里。'}</small>`;
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
    if (message.imageFile && /^[a-f0-9-]{36}$/.test(message.imageFile.id)) {
      const img = document.createElement('img');
      img.src = `${activeServer}/images/${room!.code}/${message.imageFile.id}`;
      img.alt = `${message.name} 发来的图片`;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        if (nearBottom) messages.scrollTop = messages.scrollHeight;
      };
      const link = document.createElement('a');
      link.href = img.src;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = '打开原图';
      link.onclick = (event) => {
        event.preventDefault();
        $<HTMLImageElement>('image-full').src = img.src;
        showDialog('image-dialog');
      };
      link.append(img);
      bubble.append(link);
    }
    row.append(meta, bubble);
    messages.append(row);
  }
  if (nearBottom || (room?.chat.length ?? 0) !== lastChatLength)
    messages.scrollTop = messages.scrollHeight;
  lastChatLength = room?.chat.length ?? 0;
}
async function clearPlayback(keepSite = false, keepPreview = false) {
  if (!keepPreview) broadcastFallback.close();
  playbackPermissionNeeded = false;
  sourceFailed = false;
  playerGeneration++;
  loadedMedia = '';
  loadedKind = '';
  hls?.destroy();
  hls = null;
  if (!keepPreview) {
    video.pause();
    video.srcObject = null;
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
  }
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  $('browser-hint').hidden = true;
  if (!keepSite) {
    $('native-stage').hidden = true;
    siteOpen = false;
    siteSample = null;
    if (isNative) await nativeCall('closeSite').catch(error);
  }
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
  sourceFailed = false;
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
  const epoch = room?.epoch;
  const current = () =>
    room?.media?.id === media.id && room.epoch === epoch && room.mode === 'stream';
  if (!current()) return;
  loadedMedia = media.id;
  loadedKind = 'stream';
  if (media.broadcast) {
    loadedKind = 'broadcast';
    if (media.broadcast.host === memberId && media.broadcast.kind === 'site') {
      video.hidden = true;
      siteOpen = true;
      $('native-stage').hidden = false;
      await resizeSite();
    } else {
      await hideSite(true);
      if (!current()) return;
      siteOpen = false;
      video.hidden = false;
      $('native-stage').hidden = true;
      video.muted =
        media.broadcast.host === memberId || (media.broadcast.kind === 'screen' && liveMuted);
    }
    if (!current()) return;
    configureBroadcast();
    if (
      media.broadcast.host === memberId &&
      media.broadcast.kind !== 'site' &&
      broadcast.owns(media.url)
    ) {
      const stream = publisherStream;
      if (stream) showPublisherPreview(stream);
    }
    return;
  }
  if (isNative && media.provider !== 'direct') {
    const alreadyOpen = siteOpen;
    video.hidden = true;
    siteOpen = true;
    $('native-stage').hidden = false;
    try {
      if (!alreadyOpen) await nativeCall('openSite', { url: media.url });
      await resizeSite();
    } catch (e) {
      error(e);
    }
  } else if (media.source) {
    await hideSite(true);
    if (!current()) return;
    siteOpen = false;
    await setPlayer(
      mediaPath('video'),
      media.source.audio ? mediaPath('audio') : undefined,
      media.source.kind === 'hls',
    );
  } else {
    video.hidden = true;
    $('browser-hint').hidden = false;
  }
}
function applyPlayback(explicit = false) {
  if (hasPendingPreview()) return;
  if (!room || !connected || pendingControl || (room.mode === 'cache' && !room.cacheReady)) return;
  const playback = room.playback,
    target = currentPosition();
  const seek = explicit && lastRevision !== playback.revision && playback.intent === 'seek';
  lastRevision = playback.revision;
  if (room.media?.broadcast) {
    if (room.media.broadcast.host !== memberId || room.media.broadcast.kind === 'screen') {
      // A remote MediaStream has a live timeline. Seeking or rate-correcting it
      // would freeze playback. Versioned controls instead drive the publisher.
      if (playback.paused) video.pause();
      else if (broadcastFallback.active()) broadcastFallback.resume();
      else if (video.srcObject && video.paused) playElement(video);
      return;
    }
    if (publisher) {
      const correction = reconcile(
        publisher.currentTime,
        target,
        playback.rate,
        playback.paused,
        seek,
        false,
      );
      if (correction.kind === 'seek')
        publisher.currentTime = Math.min(target, publisher.duration || target);
      publisher.playbackRate = correction.rate;
      if (playback.paused) publisher.pause();
      else if (publisher.paused) playElement(publisher);
      return;
    }
  }
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
    if (video.paused) playElement(video);
    if (audio.src && audio.paused) playElement(audio);
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
  if (document.querySelector('dialog[open]') || room?.mode === 'cache') {
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
const broadcast = new BroadcastPeers(
  send,
  (stream) => {
    if (room?.media?.broadcast?.host === memberId && room.media.broadcast.kind === 'site') return;
    if (broadcastFallback.active()) return;
    if (stream) {
      if (video.srcObject !== stream) video.srcObject = stream;
      video.hidden = false;
      video.muted =
        room?.media?.broadcast?.host === memberId ||
        (room?.media?.broadcast?.kind === 'screen' && liveMuted);
      playElement(video);
    } else if (video.srcObject) {
      // Transport reconfiguration must not detach the publisher's local preview.
      if (
        publisherStream &&
        video.srcObject === publisherStream &&
        (pendingBroadcastUrl ||
          (room?.media?.broadcast?.host === memberId && broadcast.owns(room.media.url)))
      )
        return;
      video.srcObject = null;
    }
  },
  (text) => {
    broadcastMessage = text;
    render();
  },
);
const broadcastFallback = new BroadcastRelayClient(
  video,
  (url) => {
    const previous = relayPlaybackUrl;
    relayPlaybackUrl = url ?? '';
    if (url) {
      video.srcObject = null;
      video.src = url;
      video.hidden = false;
      video.muted = room?.media?.broadcast?.kind === 'screen' && liveMuted;
    } else if (previous && video.getAttribute('src') === previous) {
      video.removeAttribute('src');
      video.load();
      const stream = broadcast.receivedStream();
      if (stream && broadcast.reception().state === 'connected') {
        video.srcObject = stream;
        playElement(video);
      }
    }
  },
  () => playElement(video),
  () => renderLiveStatus(),
);
const cache = new DeviceCache(cacheProgress, peers);
const qualitySelect = $<HTMLSelectElement>('broadcast-quality');
qualitySelect.value = ['smooth', 'hd', 'high'].includes(saved('broadcast-quality'))
  ? saved('broadcast-quality')
  : 'hd';
broadcastFallback.setQuality(qualitySelect.value);
qualitySelect.onchange = () => {
  save('broadcast-quality', qualitySelect.value);
  broadcastFallback.setQuality(qualitySelect.value);
};
function releasePublisher() {
  broadcastFallback.close();
  pendingBroadcastUrl = '';
  if (nativeCapture) {
    nativeCapture = false;
    captureEnding = nativeCall('endCapture').catch(() => {});
  }
  publisherStream = null;
  broadcast.release();
  publisherCleanup?.();
  publisherCleanup = null;
  publisher?.pause();
  publisher?.removeAttribute('src');
  publisher?.load();
  publisher = null;
  if (publisherUrl) URL.revokeObjectURL(publisherUrl);
  publisherUrl = '';
}
function shareBroadcast(
  stream: MediaStream,
  media: MediaInput,
  scope: { code: string; member: string; url: string | undefined },
) {
  if (
    !room ||
    !connected ||
    room.code !== scope.code ||
    memberId !== scope.member ||
    room.media?.url !== scope.url
  ) {
    for (const track of stream.getTracks()) track.stop();
    throw new Error('房间或视频已改变，请重新选择后共享');
  }
  pendingBroadcastUrl = media.url;
  publisherStream = stream;
  stoppingBroadcast = false;
  broadcastMessage = '';
  broadcast.publish(stream, media.url);
  if (media.broadcast?.kind === 'screen') {
    // Local capture must render before any room acknowledgement or peer exists.
    closeProvider();
    showPublisherPreview(stream);
    render();
  }
  for (const track of stream.getVideoTracks())
    track.addEventListener(
      'ended',
      () => {
        if (room?.media?.broadcast?.host === memberId && room.media.url === media.url)
          $('stop-broadcast').click();
      },
      { once: true },
    );
  operation({ type: 'media', media });
}
$('local-video-button').onclick = () => $('local-video-input').click();
$<HTMLInputElement>('local-video-input').onchange = () => {
  const input = $<HTMLInputElement>('local-video-input');
  const file = input.files?.[0];
  input.value = '';
  if (!file || !room || broadcastBusy || pendingBroadcastUrl) return;
  const scope = { code: room.code, member: memberId, url: room.media?.url };
  broadcastBusy = true;
  void (async () => {
    releasePublisher();
    const source = document.createElement('video');
    source.playsInline = true;
    source.preload = 'auto';
    source.muted = true;
    publisherUrl = URL.createObjectURL(file);
    publisher = source;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('视频读取超时')), 20000);
      source.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      source.onerror = () => {
        clearTimeout(timer);
        reject(new Error('无法读取视频，请选择设备支持的格式（推荐 H.264 / AAC MP4）'));
      };
      source.src = publisherUrl;
      source.load();
    });
    const capture = (source as HTMLVideoElement & { captureStream?: () => MediaStream })
      .captureStream;
    let stream: MediaStream;
    if (capture) {
      await source.play();
      stream = capture.call(source);
    } else {
      // Mobile Chromium does not expose video.captureStream. A bounded canvas
      // and Web Audio destination capture only the file the user selected.
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1920 / source.videoWidth, 1080 / source.videoHeight);
      canvas.width = Math.max(2, Math.round(source.videoWidth * scale));
      canvas.height = Math.max(2, Math.round(source.videoHeight * scale));
      const ctx = canvas.getContext('2d')!;
      const draw = () => {
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      };
      draw();
      const timer = setInterval(draw, 1000 / 30);
      stream = canvas.captureStream(30);
      const sound = new AudioContext();
      const audioSource = sound.createMediaElementSource(source);
      const output = sound.createMediaStreamDestination();
      audioSource.connect(output);
      audioSource.connect(sound.destination);
      for (const track of output.stream.getAudioTracks()) stream.addTrack(track);
      publisherCleanup = () => {
        clearInterval(timer);
        void sound.close();
      };
      await sound.resume();
      await source.play();
    }
    source.pause();
    source.currentTime = 0;
    source.muted = false;
    if (!stream.getVideoTracks().length) throw new Error('当前设备不支持视频画面共享');
    (source as HTMLVideoElement & { __stream?: MediaStream }).__stream = stream;
    source.onended = () => {
      if (room?.media?.broadcast?.host === memberId) $('stop-broadcast').click();
    };
    shareBroadcast(
      stream,
      {
        url: `https://videosreeeen.local/file/${crypto.randomUUID()}`,
        title: file.name.slice(0, 200) || '本地视频',
        provider: 'local',
        ...(Number.isFinite(source.duration) && source.duration > 0
          ? { duration: source.duration }
          : {}),
        broadcast: { host: memberId, kind: 'file' },
      },
      scope,
    );
  })()
    .catch((e) => {
      releasePublisher();
      error(e);
    })
    .finally(() => {
      broadcastBusy = false;
      render();
    });
};
$('broadcast-site').onclick = () => {
  if (!room?.media || !siteOpen || broadcastBusy || pendingBroadcastUrl) return;
  const media = room.media;
  const scope = { code: room.code, member: memberId, url: media.url };
  broadcastBusy = true;
  void (async () => {
    releasePublisher();
    await captureEnding;
    nativeCapture = true;
    await nativeCall('captureSite');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
      audio: true,
    });
    if (!stream.getAudioTracks().length) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error('未能捕获原站声音，请重试');
    }
    shareBroadcast(
      stream,
      {
        url: media.url,
        title: media.title,
        provider: media.provider,
        duration: siteSample?.duration || media.duration,
        broadcast: { host: memberId, kind: 'site' },
      },
      scope,
    );
  })()
    .catch((e) => {
      releasePublisher();
      error(e);
    })
    .finally(() => {
      broadcastBusy = false;
      render();
    });
};
function shareScreen() {
  if (
    !room ||
    !connected ||
    broadcastBusy ||
    pendingBroadcastUrl ||
    !navigator.mediaDevices?.getDisplayMedia
  )
    return;
  const scope = { code: room.code, member: memberId, url: room.media?.url };
  broadcastBusy = true;
  provideError = '';
  render();
  // Invoke directly during the click: browsers require transient user activation.
  let capture: Promise<MediaStream>;
  try {
    capture = navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: { ideal: 30, max: 30 } },
      audio: true,
      selfBrowserSurface: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch (e) {
    broadcastBusy = false;
    provideError = e instanceof Error ? e.message : String(e);
    render();
    error(e);
    return;
  }
  void capture
    .then((stream) => {
      releasePublisher();
      shareBroadcast(
        stream,
        {
          url: `https://videosreeeen.local/screen/${crypto.randomUUID()}`,
          title: '共享画面',
          provider: 'other',
          broadcast: { host: memberId, kind: 'screen' },
        },
        scope,
      );
      if (!stream.getAudioTracks().length) toast('此次共享没有声音；共享标签页时请勾选“共享音频”');
    })
    .catch((e) => {
      provideError =
        e?.name === 'NotAllowedError' || e?.name === 'AbortError'
          ? '共享未开始，可重新选择标签页并允许共享'
          : e instanceof Error
            ? e.message
            : String(e);
      toast(provideError);
    })
    .finally(() => {
      broadcastBusy = false;
      render();
    });
}
$('broadcast-screen').onclick = shareScreen;
$('browser-share-tab').onclick = shareScreen;
$('stop-broadcast').onclick = () => {
  if (stoppingBroadcast || room?.media?.broadcast?.host !== memberId) return;
  stoppingBroadcast = true;
  releasePublisher();
  operation({ type: 'unshare' });
};
function configureBroadcast() {
  if (connected) {
    broadcast.configure(room, memberId, !broadcastRelayEnabled);
    broadcastFallback.configure(
      room,
      memberId,
      resume,
      activeServer,
      broadcastRelayEnabled,
      publisherStream,
      broadcast.reception().state === 'connected',
    );
  }
}
setInterval(configureBroadcast, 3000);
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
  else openDialog($<HTMLInputElement>('invite-input').value ? 'join' : 'create');
};
$('hero-create').onclick = () => {
  if (room) {
    $('playback-picker').scrollIntoView({ behavior: 'smooth', block: 'center' });
    document
      .querySelector<HTMLElement>('.playback-tabs [aria-selected="true"]')
      ?.focus({ preventScroll: true });
  } else openDialog();
};
$('hero-join').onclick = () => {
  if (room) void invite();
  else openDialog('join');
};
$('sidebar-invite').onclick = () => {
  if (room) void invite();
  else openDialog();
};
$('settings-button').onclick = () => {
  $<HTMLInputElement>('server-input').value = configuredServer;
  $('settings-error').textContent = '';
  $('settings-status').textContent = room
    ? `当前房间连接 ${new URL(activeServer).host}；修改仅在下次生效。`
    : '';
  showDialog('settings-dialog');
};
$('copy-video-diagnostics').onclick = () => {
  const button = $<HTMLButtonElement>('copy-video-diagnostics');
  button.disabled = true;
  $('video-diagnostics-status').textContent = '正在读取连接状态…';
  void (async () => {
    const network = await broadcast.diagnostics();
    const output = $<HTMLTextAreaElement>('video-diagnostics-output');
    output.value = JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        build: document
          .querySelector<HTMLScriptElement>('script[type="module"]')
          ?.getAttribute('src')
          ?.split('/')
          .pop(),
        roomConnected: connected,
        mediaKind: room?.media?.broadcast?.kind ?? null,
        ...network,
        fallback: broadcastFallback.diagnostics(),
        player: {
          bound: !!video.srcObject || broadcastFallback.active(),
          transport: broadcastFallback.active() ? 'websocket' : video.srcObject ? 'webrtc' : 'none',
          paused: video.paused,
          readyState: video.readyState,
          width: video.videoWidth,
          height: video.videoHeight,
          frames: video.getVideoPlaybackQuality().totalVideoFrames,
        },
      },
      null,
      2,
    );
    output.hidden = false;
    try {
      await navigator.clipboard.writeText(output.value);
      $('video-diagnostics-status').textContent = '连接诊断已复制';
    } catch {
      output.focus();
      output.select();
      $('video-diagnostics-status').textContent = '诊断已生成，请复制下方内容';
    }
  })()
    .catch(error)
    .finally(() => {
      button.disabled = false;
    });
};
$('settings-form').onsubmit = (event) => {
  event.preventDefault();
  try {
    const origin = serverOrigin($<HTMLInputElement>('server-input').value);
    if (location.protocol === 'https:' && !isNative && !origin.startsWith('https:'))
      throw new Error('网页版需要 HTTPS 服务器；局域网 HTTP 请使用客户端。');
    configuredServer = origin;
    save('server', origin);
    $('settings-error').textContent = '';
    $('settings-status').textContent =
      `已保存：${new URL(origin).host}，下次建房或使用邀请码时生效。`;
  } catch (e) {
    $('settings-error').textContent = (e as Error).message;
  }
};
$('reset-server').onclick = () => {
  $<HTMLInputElement>('server-input').value = defaultServer;
  $<HTMLFormElement>('settings-form').requestSubmit();
};
for (const node of document.querySelectorAll<HTMLButtonElement>('[data-close]'))
  node.onclick = () => $<HTMLDialogElement>(node.dataset.close!).close();
for (const modal of document.querySelectorAll('dialog'))
  modal.addEventListener('close', () => {
    void resizeSite();
  });
dialog.addEventListener('cancel', (event) => {
  if (connecting) event.preventDefault();
});
$('create-tab').onclick = () => setRoomIntent('create');
$('join-tab').onclick = () => setRoomIntent('join');
$('invite-input').oninput = updateInviteHint;
$('dialog-close').onclick = closeDialog;
$('room-form').onsubmit = (event) => {
  event.preventDefault();
  if (connecting) return;
  const intent = roomIntent;
  connecting = true;
  for (const id of ['create-button', 'join-button', 'create-tab', 'join-tab', 'dialog-close'])
    $<HTMLButtonElement>(id).disabled = true;
  $(`${intent}-button`).textContent = intent === 'create' ? '正在创建房间…' : '正在加入房间…';
  $('dialog-error').textContent = '';
  void connect(intent)
    .then(() => {
      if (intent === 'create') void invite();
    })
    .catch((e) => {
      desiredSession = false;
      $('dialog-error').textContent = e.message;
    })
    .finally(() => {
      connecting = false;
      for (const id of ['create-button', 'join-button', 'create-tab', 'join-tab', 'dialog-close'])
        $<HTMLButtonElement>(id).disabled = false;
      $('create-button').textContent = '创建房间并生成邀请';
      $('join-button').textContent = '加入朋友的房间';
    });
};
async function invite() {
  if (!room) {
    openDialog();
    return;
  }
  $<HTMLInputElement>('invite-link').value = `${activeServer}/#${room.invite}`;
  $<HTMLInputElement>('invite-code').value = room.invite;
  $('invite-feedback').textContent = '';
  $('share-invite').hidden = typeof navigator.share !== 'function';
  showDialog('invite-dialog');
}
async function copyInvite(id: string) {
  const input = $<HTMLInputElement>(id);
  try {
    await navigator.clipboard.writeText(input.value);
    $('invite-feedback').textContent = '已复制，发给朋友即可加入。';
  } catch {
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    $('invite-feedback').textContent = '未能自动复制，邀请已选中；请长按或按 Ctrl+C 复制。';
  }
}
$('copy-link').onclick = () => {
  void copyInvite('invite-link');
};
$('copy-code').onclick = () => {
  void copyInvite('invite-code');
};
$('share-invite').onclick = () => {
  void navigator
    .share({ title: '来 VideoSreeeen 一起看', url: $<HTMLInputElement>('invite-link').value })
    .catch((e) => {
      if (e.name !== 'AbortError')
        $('invite-feedback').textContent = '系统分享不可用，请复制邀请链接发送。';
    });
};
function openExternal(url: string) {
  if (isNative) void nativeCall('openBrowser', { url }).catch(error);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
$('project-link').onclick = () =>
  openExternal('https://github.com/BorderArea01/VideoSreeeen#readme');
$('feedback-link').onclick = () =>
  openExternal('https://github.com/BorderArea01/VideoSreeeen/issues');
$('invite-button').onclick = () => {
  void invite();
};
$('source-form').onsubmit = (event) => {
  event.preventDefault();
  try {
    const media = describeUrl($<HTMLInputElement>('source-url').value);
    if (!isNative && !media.source) {
      $('link-error').textContent =
        '这是原站页面，网页版无法直接同步它的播放器。可改用共享画面；视频直链仍可共同播放。';
      $('link-unavailable').hidden = false;
      return;
    }
    $('link-unavailable').hidden = true;
    operation({ type: 'media', media });
  } catch (e) {
    error(e);
  }
};
$('source-url').oninput = () => {
  $('link-unavailable').hidden = true;
};
$('link-use-screen').onclick = () => {
  try {
    const media = describeUrl($<HTMLInputElement>('source-url').value);
    requestedScreenPage = media.url;
    playbackPicker.select('screen');
    operation({ type: 'media', media });
  } catch (e) {
    error(e);
  }
};
$('screen-page-form').onsubmit = (event) => {
  event.preventDefault();
  try {
    const media = describeUrl($<HTMLInputElement>('screen-page-url').value);
    if (isNative) {
      requestedScreenPage = media.url;
      operation({ type: 'media', media });
    } else openExternal(media.url);
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
    const mediaId = room.media.id;
    const sample = (await nativeCall('sampleSite')) as Sample;
    shareSiteSource(sample, mediaId);
  })().catch(error);
};
function shareSiteSource(sample: Sample, mediaId: string) {
  if (room?.media?.id !== mediaId) return;
  if (!sample.source) throw new Error('尚未检测到视频源，请在原站按正常流程登录并开始播放，再重试');
  const media: MediaInput = {
    url: room.media.url,
    provider: room.media.provider,
    title: (sample.title || room.media.title).slice(0, 200),
    source: sample.source,
    ...(sample.duration && sample.duration > 0 ? { duration: sample.duration } : {}),
  };
  operation({ type: 'media', media });
}

$('browser-invite').onclick = () => {
  void invite();
};
$('browser-open-site').onclick = () => {
  if (room?.media && room.media.provider !== 'direct') {
    openedSourceMediaId = room.media.id;
    provideError = '';
    render();
    openExternal(room.media.url);
  }
};
$('browser-provide').onclick = openProvider;
$('browser-takeover').onclick = openProvider;
$('provide-local-video').onclick = () => $('local-video-button').click();
$('browser-local-video').onclick = () => $('local-video-button').click();
$('browser-help').onclick = () => {
  $('settings-button').click();
  $<HTMLDetailsElement>('watch-help').open = true;
};
$('play-button').onclick = () => {
  if (room?.media?.broadcast?.kind === 'screen' || hasPendingPreview()) return;
  if (playbackPermissionNeeded && !room?.playback.paused) {
    playElement(video);
    if (publisher) playElement(publisher);
    if (audio.src) playElement(audio);
    return;
  }
  if (!room?.playback.paused) control('pause');
  else {
    if (
      !video.hidden &&
      (video.src || video.srcObject) &&
      !(room?.mode === 'cache' && !room.cacheReady)
    ) {
      playElement(video);
      if (publisher) playElement(publisher);
      if (audio.src) playElement(audio);
    }
    control('play');
  }
};
$('live-sound').onclick = () => {
  if ($('live-sound').hidden) return;
  liveMuted = playbackPermissionNeeded ? false : !liveMuted;
  video.muted = liveMuted;
  // A user gesture unlocks local playback; it must not pause the whole room.
  if (playbackPermissionNeeded) playElement(video);
  renderLiveSound();
};
video.onclick = () => {
  if (room?.media?.broadcast?.kind === 'screen' || hasPendingPreview()) {
    if (playbackPermissionNeeded) $('live-sound').click();
  } else $('play-button').click();
};
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
for (const element of [video, audio])
  element.addEventListener('playing', () => {
    if (playbackPermissionNeeded && !video.paused && (!audio.src || !audio.paused)) {
      playbackPermissionNeeded = false;
      render();
    }
  });
function playbackError() {
  if (!video.getAttribute('src')) return;
  if (room?.mode === 'stream') {
    sourceFailed = true;
    video.pause();
    audio.pause();
    video.hidden = true;
    render();
  } else toast('本地视频无法播放，请检查格式或换用客户端。');
}
video.onerror = playbackError;
audio.onerror = playbackError;
$('leave-button').onclick = () => {
  releasePublisher();
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
  if (file.size > 20 * 1024 * 1024) {
    toast('图片最大 20 MiB，支持 GIF 原图');
    input.value = '';
    return;
  }
  if (!room || !connected) return;
  const code = room.code;
  const button = $<HTMLButtonElement>('image-button');
  button.disabled = true;
  button.title = '正在发送图片…';
  void fetch(`${activeServer}/images/${code}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      Authorization: `Bearer ${resume}`,
      'X-Member-Id': memberId,
    },
    body: file,
    signal: AbortSignal.timeout(120000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
    })
    .catch(error)
    .finally(() => {
      input.value = '';
      button.disabled = false;
      button.title = '发送图片或 GIF（最大 20 MiB）';
    });
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
window.addEventListener('hashchange', () => {
  const value = inviteFromLocation();
  if (!room && !connecting && value) {
    $<HTMLInputElement>('invite-input').value = value;
    openDialog('join');
  }
});
window.addEventListener('pagehide', () => {
  releasePublisher();
  void cache.clear().catch(() => {});
});
setInterval(() => {
  renderLiveStatus();
  if (room) {
    applyPlayback();
    if (room.media?.broadcast?.kind !== 'screen' && !hasPendingPreview()) {
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
    }
    $('sync-status').textContent = !connected
      ? '离线 · 暂停控制'
      : hasPendingPreview()
        ? '本机预览 · 等待房间确认'
        : room.mode === 'cache' && !room.cacheReady
          ? '等待完整缓存'
          : sourceFailed
            ? '视频未就绪'
            : room.media?.broadcast
              ? $('live-status').textContent || '共享已开始'
              : !isNative && room.media && !room.media.source
                ? '视频尚未开始提供'
                : `WebSocket 同步${rtt === null ? '' : ' · ' + Math.round(rtt) + ' ms'}`;
  }
}, 300);
setInterval(() => {
  if (connected) send({ type: 'ping', sentAt: performance.now() });
}, 5000);
setInterval(() => {
  if (!siteOpen || !connected || nativeBusy) return;
  const expectedMediaId = room?.media?.id;
  void nativeCall('sampleSite')
    .then((sample: Sample) => {
      if (!expectedMediaId || room?.media?.id !== expectedMediaId) return;
      const availabilityChanged = siteSample?.available !== sample.available;
      siteSample = sample;
      if (availabilityChanged) render();
      if (
        !room.media.source &&
        !room.media.broadcast &&
        sample.available &&
        sample.source &&
        !pendingControl &&
        autoSharedMedia !== expectedMediaId
      ) {
        autoSharedMedia = expectedMediaId;
        shareSiteSource(sample, expectedMediaId);
        return;
      }
      if (!room?.media || !sample.available || !sample.action || sample.seq === undefined) return;
      if (sample.frame !== remoteFrame) {
        remoteFrame = sample.frame ?? '';
        lastRemoteSeq = sample.seq;
        return;
      }
      if (sample.seq <= lastRemoteSeq) return;
      lastRemoteSeq = sample.seq;
      if (sample.action === 'ended') {
        if (room.media.broadcast?.host === memberId) {
          $('stop-broadcast').click();
          return;
        }
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
setupUpdates();
render();
if (initialInvite) openDialog('join');
