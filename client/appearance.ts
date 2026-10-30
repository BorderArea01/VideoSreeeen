import './themes.css';
import { GlitchScene } from './appearance-scene';
import { DaylightLayout } from './appearance-layout';

const themes = ['classic', 'glitch'] as const;
type Theme = (typeof themes)[number];
const preferenceKey = 'videosreeeen.appearance';
const sessionKey = 'videosreeeen.appearance.session';
const names: Record<Theme, string> = { classic: '暖夜 · 原版', glitch: '天光断层 · Glitch Art' };
const valid = (value: string | null): value is Theme => themes.includes(value as Theme);
function read(kind: 'localStorage' | 'sessionStorage', key: string) {
  try {
    return window[kind].getItem(key);
  } catch {
    return null;
  }
}
function write(kind: 'localStorage' | 'sessionStorage', key: string, value: string | null) {
  try {
    if (value === null) window[kind].removeItem(key);
    else window[kind].setItem(key, value);
  } catch {
    // Appearance remains usable when browser storage is unavailable.
  }
}
function randomTheme(): Theme {
  return themes[crypto.getRandomValues(new Uint32Array(1))[0]! % themes.length]!;
}
const preference = read('localStorage', preferenceKey);
const session = read('sessionStorage', sessionKey);
const navigation = performance.getEntriesByType('navigation')[0] as
  PerformanceNavigationTiming | undefined;
// A shareable preview can select a skin without changing the invitation hash.
const pageUrl = new URL(location.href);
const requested = pageUrl.searchParams.get('skin');
let automatic = !valid(preference);
let current: Theme = valid(preference)
  ? preference
  : valid(session) && navigation?.type !== 'navigate'
    ? session
    : randomTheme();
if (valid(requested)) {
  current = requested;
  automatic = false;
  write('localStorage', preferenceKey, current);
  pageUrl.searchParams.delete('skin');
  history.replaceState(history.state, '', pageUrl);
}
let scene: GlitchScene | undefined;
let layout: DaylightLayout | undefined;
function apply() {
  document.documentElement.dataset.theme = current;
  if (current === 'glitch') scene ??= new GlitchScene();
  scene?.setActive(current === 'glitch');
  layout?.setActive(current === 'glitch');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', current === 'glitch' ? '#1768ce' : '#101014');
  write('sessionStorage', sessionKey, current);
}
// Set the theme before main.ts builds the application. Never touches a player or room state.
apply();

export function setupAppearance(settings: HTMLElement) {
  // main.ts creates the real voice and player controls synchronously after this call.
  queueMicrotask(() => {
    layout = new DaylightLayout();
    layout.setActive(current === 'glitch');
  });
  settings.querySelector('.dialog-heading')!.insertAdjacentHTML(
    'afterend',
    `
    <section class="appearance-settings" aria-labelledby="appearance-title">
      <div class="appearance-heading"><h3 id="appearance-title">界面皮肤</h3><span>仅本机</span></div>
      <fieldset class="theme-choices"><legend class="theme-sr-only">选择界面皮肤</legend>
        <label class="theme-choice"><input type="radio" name="appearance" value="classic"><span class="theme-swatch theme-swatch-classic" aria-hidden="true"><i></i><b></b><em></em></span><span class="theme-choice-name">暖夜 <small>原版</small></span></label>
        <label class="theme-choice"><input type="radio" name="appearance" value="glitch"><span class="theme-swatch theme-swatch-glitch" aria-hidden="true"><i></i><b></b><em></em></span><span class="theme-choice-name">天光断层 <small>Glitch Art</small></span></label>
      </fieldset>
      <div class="appearance-auto"><span id="appearance-status" role="status"></span><button id="appearance-random" type="button" class="text-button" title="重新随机选择皮肤；未手动选择时，新标签页自动分配">随机选择</button></div>
    </section>`,
  );
  const choices = settings.querySelectorAll<HTMLInputElement>('input[name="appearance"]');
  const update = () => {
    for (const choice of choices) choice.checked = choice.value === current;
    settings.querySelector('#appearance-status')!.textContent = automatic
      ? '随机分配 · 刷新保持'
      : '已记住你的选择';
    settings
      .querySelector('#appearance-random')!
      .setAttribute('aria-label', `随机选择皮肤，当前${names[current]}`);
    const entry = document.getElementById('appearance-button');
    if (entry) {
      entry.title = `切换皮肤 · ${names[current]}`;
      entry.setAttribute('aria-label', `切换皮肤，当前${names[current]}`);
    }
  };
  const select = (choice: HTMLInputElement) => {
    if (!choice.checked || !valid(choice.value)) return;
    if (!automatic && current === choice.value) return;
    current = choice.value;
    automatic = false;
    write('localStorage', preferenceKey, current);
    apply();
    update();
  };
  for (const choice of choices) {
    choice.addEventListener('click', () => select(choice));
    choice.addEventListener('change', () => select(choice));
  }
  settings.querySelector('#appearance-random')!.addEventListener('click', () => {
    current = randomTheme();
    automatic = true;
    write('localStorage', preferenceKey, null);
    apply();
    update();
  });
  const entry = document.createElement('button');
  entry.id = 'appearance-button';
  entry.type = 'button';
  entry.className = 'icon-button';
  entry.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1.1-2.6H17a4 4 0 0 0 4-4 9 9 0 0 0-9-8Z"/><circle cx="7" cy="10" r=".8"/><circle cx="10" cy="6.5" r=".8"/><circle cx="15" cy="7" r=".8"/></svg>';
  entry.onclick = () => {
    document.getElementById('settings-button')!.click();
    settings.querySelector('.appearance-settings')!.scrollIntoView({ block: 'nearest' });
    settings
      .querySelector<HTMLInputElement>('input[name="appearance"]:checked')!
      .focus({ preventScroll: true });
  };
  document.getElementById('settings-button')!.before(entry);
  update();
}
