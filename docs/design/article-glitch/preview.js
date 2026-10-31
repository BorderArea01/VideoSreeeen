const schemes = {
  a: {
    name: '硫黄脉冲',
    subtitle: 'SULFUR / SIGNAL',
    note: '黄黑大色块 · 品红 / 冰青切片 · 高对比硬切',
  },
  b: {
    name: '薄荷断讯',
    subtitle: 'MINT / DISCONNECT',
    note: '薄荷白 / 墨绿 · 酸橙侧影 · 留白中的短促断讯',
  },
  c: {
    name: '紫电残像',
    subtitle: 'VIOLET / AFTERIMAGE',
    note: '紫黑 / 电粉 · 青色残像 · 双次信号撕裂',
  },
  d: {
    name: '锈红银幕',
    subtitle: 'OXIDE / SILVER',
    note: '暖银 / 锈红 · 冰青偏移 · 金属面板与胶片断层',
  },
};
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const scheme = Object.hasOwn(schemes, params.get('scheme')) ? params.get('scheme') : 'a';
root.dataset.scheme = scheme;
document.title = `${scheme.toUpperCase()} ${schemes[scheme].name} · VideoSreeeen 交互方案`;
document.querySelector('#scheme-name').textContent = schemes[scheme].name;
document.querySelector('#scheme-subtitle').textContent = schemes[scheme].subtitle;
document.querySelector('#scheme-note').textContent = schemes[scheme].note;
document.querySelector('.edition-number').textContent = scheme.toUpperCase();
document.querySelector(`[data-choice="${scheme}"]`).setAttribute('aria-current', 'page');

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let motionEnabled = !reduced.matches;
const motionToggle = document.querySelector('.motion-toggle');
const timers = new Map();
const lastFired = new WeakMap();
function stopEffects() {
  for (const [element, timer] of timers) {
    clearTimeout(timer);
    element.classList.remove('is-glitching');
  }
  timers.clear();
}
function updateMotion() {
  root.dataset.motion = motionEnabled && !reduced.matches ? 'on' : 'off';
  motionToggle.textContent = `动效 ${root.dataset.motion === 'on' ? '开' : '关'}`;
  motionToggle.setAttribute('aria-pressed', String(root.dataset.motion === 'on'));
  if (root.dataset.motion === 'off') stopEffects();
}
motionToggle.addEventListener('click', () => {
  motionEnabled = !motionEnabled;
  updateMotion();
});
reduced.addEventListener('change', updateMotion);
updateMotion();

// JavaScript only starts a finite CSS sequence; it neither draws pixels nor follows the cursor.
function burst(element) {
  if (root.dataset.motion !== 'on' || document.hidden || timers.has(element)) return;
  const now = performance.now();
  if (now - (lastFired.get(element) ?? -Infinity) < 1250) return;
  lastFired.set(element, now);
  element.classList.add('is-glitching');
  timers.set(
    element,
    setTimeout(() => {
      element.classList.remove('is-glitching');
      timers.delete(element);
    }, 1050),
  );
}
for (const button of document.querySelectorAll('[data-glitch]')) {
  if (button.querySelector('svg')) {
    const copy = document.createElement('span');
    copy.className = 'control-copy';
    copy.setAttribute('aria-hidden', 'true');
    for (const child of [...button.childNodes]) copy.append(child.cloneNode(true));
    button.classList.add('has-copy');
    button.append(copy);
  }
  button.addEventListener('pointerenter', () => burst(button));
  button.addEventListener('focus', () => burst(button));
}
for (const frame of document.querySelectorAll('[data-fracture]')) {
  frame.addEventListener('pointermove', (event) => {
    const rect = frame.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (
      x < Math.min(50, rect.width * 0.12) ||
      x > rect.width - Math.min(50, rect.width * 0.12) ||
      y < 15 ||
      y > rect.height - 15
    )
      burst(frame);
  });
}
document
  .querySelector('.brand-block')
  .addEventListener('pointerenter', (event) => burst(event.currentTarget));
document.addEventListener('pointermove', (event) => {
  if (event.target.closest('.frame, .chooser, .masthead')) return;
  burst(document.querySelector('.sky'));
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopEffects();
});

let toastTimer;
function toast(text) {
  const element = document.querySelector('.toast');
  element.textContent = text;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, 3500);
}
document.querySelector('.chat-toggle').addEventListener('click', (event) => {
  const hidden = document.body.classList.toggle('chat-hidden');
  const button = event.currentTarget;
  button.title = hidden ? '展开聊天室' : '隐藏聊天室';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-expanded', String(!hidden));
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
  const content = document.createElement('div');
  const name = document.createElement('header');
  name.textContent = '你 · 本机预览';
  const text = document.createElement('p');
  text.textContent = input.value.trim();
  content.append(name, text);
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
for (const tab of document.querySelectorAll('[data-mode]'))
  tab.addEventListener('click', () => {
    for (const sibling of document.querySelectorAll('[data-mode]'))
      sibling.setAttribute('aria-selected', String(sibling === tab));
    document.querySelector('.mode-description').textContent = descriptions[tab.dataset.mode];
  });
const modeTabs = [...document.querySelectorAll('[data-mode]')];
for (const tab of modeTabs)
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = modeTabs.indexOf(tab);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? modeTabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + modeTabs.length) % modeTabs.length;
    modeTabs[next].focus();
    modeTabs[next].click();
  });
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
    toast('样片暂时无法加载，仍可比较配色与鼠标交互。');
  }
});
window.addEventListener('pagehide', () => {
  stopEffects();
  clearTimeout(toastTimer);
});
