import './themes/core/picker.css';
import { themeRegistry } from './themes/catalog';
import { ThemeController } from './themes/core/controller';

const preferenceKey = 'videosreeeen.appearance';
const sessionKey = 'videosreeeen.appearance.session';
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
    /* Appearance works when storage is blocked. */
  }
}
function randomTheme() {
  const themes = themeRegistry.list();
  return themes[crypto.getRandomValues(new Uint32Array(1))[0]! % themes.length]!.id;
}
const preference = read('localStorage', preferenceKey),
  session = read('sessionStorage', sessionKey);
const navigation = performance.getEntriesByType('navigation')[0] as
  PerformanceNavigationTiming | undefined;
const pageUrl = new URL(location.href),
  requested = pageUrl.searchParams.get('skin');
let automatic = !themeRegistry.has(preference);
let initial = themeRegistry.has(preference)
  ? preference
  : themeRegistry.has(session) && navigation?.type !== 'navigate'
    ? session
    : randomTheme();
if (themeRegistry.has(requested)) {
  initial = requested;
  automatic = false;
  write('localStorage', preferenceKey, initial);
  pageUrl.searchParams.delete('skin');
  history.replaceState(history.state, '', pageUrl);
}

export const themeController = new ThemeController(themeRegistry);

export function setupAppearance(settings: HTMLElement) {
  settings.querySelector('.dialog-heading')!.insertAdjacentHTML(
    'afterend',
    `
    <section class="appearance-settings" aria-labelledby="appearance-title">
      <div class="appearance-heading"><h3 id="appearance-title">界面皮肤</h3><span>仅本机</span></div>
      <fieldset class="theme-choices"><legend class="theme-sr-only">选择界面皮肤</legend></fieldset>
      <div class="appearance-auto"><span id="appearance-status" role="status"></span><button id="appearance-random" type="button" class="text-button" title="重新随机选择皮肤；未手动选择时，新标签页自动分配">随机选择</button></div>
    </section>`,
  );
  const choices = settings.querySelector('.theme-choices')!;
  function renderChoices() {
    choices.querySelectorAll('.theme-choice').forEach((node) => node.remove());
    for (const definition of themeRegistry.list()) {
      const label = document.createElement('label');
      label.className = 'theme-choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'appearance';
      input.value = definition.id;
      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      for (const [key, value] of Object.entries(definition.preview))
        swatch.style.setProperty('--theme-preview-' + key, value);
      swatch.append(
        document.createElement('i'),
        document.createElement('b'),
        document.createElement('em'),
      );
      const name = document.createElement('span');
      name.className = 'theme-choice-name';
      name.textContent = definition.name;
      if (definition.hint) {
        const hint = document.createElement('small');
        hint.textContent = definition.hint;
        name.append(hint);
      }
      label.append(input, swatch, name);
      choices.append(label);
    }
  }
  function update() {
    const state = themeController.snapshot();
    const selected = state.loading ? state.requested : state.active;
    for (const input of choices.querySelectorAll<HTMLInputElement>('input'))
      input.checked = input.value === selected;
    if (state.loading) document.documentElement.dataset.themeLoading = 'true';
    else delete document.documentElement.dataset.themeLoading;
    settings.querySelector('#appearance-status')!.textContent = state.loading
      ? '正在加载主题…'
      : state.failed
        ? '主题暂不可用'
        : automatic
          ? '随机分配 · 刷新保持'
          : '已记住你的选择';
    const definition = themeRegistry.get(selected) ?? themeRegistry.get(themeRegistry.defaultId)!;
    const name = definition.name + (definition.hint ? ' · ' + definition.hint : '');
    settings
      .querySelector('#appearance-random')!
      .setAttribute('aria-label', `随机选择皮肤，当前${name}`);
    const entry = document.getElementById('appearance-button');
    if (entry) {
      entry.title = `切换皮肤 · ${name}`;
      entry.setAttribute('aria-label', `切换皮肤，当前${name}`);
    }
    if (!state.loading) write('sessionStorage', sessionKey, state.active);
  }
  let selection = 0;
  function select(id: string, random = false) {
    const ticket = ++selection;
    automatic = random;
    if (random) write('localStorage', preferenceKey, null);
    void themeController.select(id).then((applied) => {
      if (applied && ticket === selection && !random) write('localStorage', preferenceKey, id);
      update();
    });
  }
  choices.addEventListener('change', (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.checked &&
      themeRegistry.has(event.target.value)
    )
      select(event.target.value);
  });
  // Clicking an already selected automatic choice still makes it a preference.
  choices.addEventListener('click', (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.checked &&
      automatic &&
      themeRegistry.has(event.target.value)
    )
      select(event.target.value);
  });
  settings
    .querySelector('#appearance-random')!
    .addEventListener('click', () => select(randomTheme(), true));
  themeController.subscribe(update);
  themeRegistry.subscribe(() => {
    const saved = read('localStorage', preferenceKey);
    if (saved && !themeRegistry.has(saved)) {
      write('localStorage', preferenceKey, null);
      automatic = true;
    }
    renderChoices();
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
    choices.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true });
  };
  document.getElementById('settings-button')!.before(entry);
  renderChoices();
  update();
  // The application finishes creating its real controls before theme portals mount.
  queueMicrotask(() => {
    void themeController.select(initial);
  });
}
