const schemes = {
  a: { name: '明黄断电', note: '明黄 / 碳黑 · 蓝紫反相 · 硬切断电' },
  b: { name: '赤白偏移', note: '纸白 / 朱红 · 青色反相 · 印刷错位' },
  c: { name: '紫电噪讯', note: '紫黑 / 酸绿 · 蓝紫反相 · 短促噪讯' },
  d: { name: '钴蓝反相', note: '钴蓝 / 米白 · 橙蓝反相 · 冷暖对冲' },
};
const root = document.documentElement;
const requested = new URLSearchParams(location.search).get('scheme');
const scheme = Object.hasOwn(schemes, requested) ? requested : 'a';
root.dataset.scheme = scheme;
document.title = scheme.toUpperCase() + ' ' + schemes[scheme].name + ' · VideoSreeeen';
document.querySelector('#scheme-name').textContent = schemes[scheme].name;
document.querySelector('#scheme-note').textContent = schemes[scheme].note;
document.querySelector('#scheme-letter').textContent = scheme.toUpperCase();
document.querySelector('[data-choice="' + scheme + '"]').setAttribute('aria-current', 'page');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let enabled = !reduced.matches;
const toggle = document.querySelector('.motion-toggle'),
  timers = new Map(),
  last = new WeakMap();
function stopEffects() {
  for (const [el, timer] of timers) {
    clearTimeout(timer);
    el.classList.remove('is-glitching');
  }
  timers.clear();
}
function updateMotion() {
  root.dataset.motion = enabled && !reduced.matches ? 'on' : 'off';
  toggle.textContent = '动效 ' + (root.dataset.motion === 'on' ? '开' : '关');
  toggle.setAttribute('aria-pressed', String(root.dataset.motion === 'on'));
  if (root.dataset.motion === 'off') stopEffects();
}
toggle.addEventListener('click', () => {
  enabled = !enabled;
  updateMotion();
});
reduced.addEventListener('change', updateMotion);
updateMotion();
function burst(el) {
  if (root.dataset.motion !== 'on' || document.hidden || timers.has(el)) return;
  if (performance.now() - (last.get(el) ?? -Infinity) < 1100) return;
  last.set(el, performance.now());
  el.classList.add('is-glitching');
  timers.set(
    el,
    setTimeout(() => {
      el.classList.remove('is-glitching');
      timers.delete(el);
    }, 950),
  );
}
// Exact non-interactive copies of surface, text and icon; the video never has copies.
for (const button of document.querySelectorAll('[data-glitch]')) {
  const original = [...button.childNodes];
  for (const name of ['control-copy', 'control-counter']) {
    const copy = document.createElement('span');
    copy.className = name;
    copy.setAttribute('aria-hidden', 'true');
    for (const child of original) copy.append(child.cloneNode(true));
    button.append(copy);
  }
  button.addEventListener('pointerenter', () => burst(button));
  button.addEventListener('focus', () => burst(button));
}
for (const panel of document.querySelectorAll('[data-fracture]'))
  panel.addEventListener('pointermove', (event) => {
    const rect = panel.getBoundingClientRect(),
      y = event.clientY - rect.top;
    if (y < 20 || y > rect.height - 20) burst(panel);
  });
document.addEventListener('pointermove', (event) => {
  if (!event.target.closest('.panel,.film-column,.study-nav'))
    burst(document.querySelector('.ambient-field'));
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopEffects();
});
let toastTimer;
function toast(text) {
  const el = document.querySelector('.toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}
document.querySelector('.chat-toggle').addEventListener('click', (event) => {
  const hidden = document.body.classList.toggle('chat-hidden');
  event.currentTarget.setAttribute('aria-expanded', String(!hidden));
  event.currentTarget.setAttribute('aria-label', hidden ? '展开聊天室' : '隐藏聊天室');
  event.currentTarget.title = hidden ? '展开聊天室' : '隐藏聊天室';
});
document.querySelector('.message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = event.currentTarget.querySelector('input');
  if (!input.value.trim()) return;
  const item = document.createElement('div');
  item.className = 'message';
  const avatar = document.createElement('span');
  avatar.className = 'avatar avatar-three';
  avatar.textContent = '我';
  const content = document.createElement('div'),
    name = document.createElement('header'),
    message = document.createElement('p');
  name.textContent = '你 · 本机预览';
  message.textContent = input.value.trim();
  content.append(name, message);
  item.append(avatar, content);
  const log = document.querySelector('.messages');
  log.append(item);
  while (log.children.length > 30) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
  input.value = '';
});
const descriptions = {
  together: '各自加载，同步进度。',
  screen: '共享画面面板预览 · 此处不发起屏幕共享。',
  file: '本地视频面板预览 · 此处不读取或上传文件。',
};
const tabs = [...document.querySelectorAll('[data-mode]')];
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const sibling of tabs) sibling.setAttribute('aria-selected', String(sibling === tab));
    document.querySelector('.mode-description').textContent = descriptions[tab.dataset.mode];
  });
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(tab),
      next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  });
}
document.querySelector('.source-form').addEventListener('submit', (event) => {
  event.preventDefault();
  toast('这是独立设计预览，不会同步到任何真实房间。');
});
document.querySelector('.voice-preview').addEventListener('click', () => {
  const panel = document.querySelector('.voice-panel');
  panel.hidden = !panel.hidden;
});
document.querySelector('.load-film').addEventListener('click', async () => {
  const video = document.querySelector('video');
  if (!video.src)
    video.src = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  try {
    await video.play();
    document.querySelector('.video-surface').classList.add('video-started');
  } catch {
    toast('样片暂时无法加载，仍可比较样式和动效。');
  }
});
window.addEventListener('pagehide', () => {
  stopEffects();
  clearTimeout(toastTimer);
});
