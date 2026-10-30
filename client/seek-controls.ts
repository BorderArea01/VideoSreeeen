import type Hls from 'hls.js';

export type SeekState = {
  key: string;
  duration: number;
  position: number;
  enabled: boolean;
  window?: { start: number; end: number };
  source?: { src: string; hls: boolean };
};
const clamp = (value: number, duration: number) => Math.max(0, Math.min(duration, value));
const time = (value: number) => {
  const n = Math.max(0, Math.floor(value));
  return (
    (n >= 3600 ? Math.floor(n / 3600) + ':' : '') +
    String(Math.floor(n / 60) % 60).padStart(2, '0') +
    ':' +
    String(n % 60).padStart(2, '0')
  );
};

/** Incremental motion keeps the target continuous when changing precision. */
export function scrubStep(
  position: number,
  dx: number,
  rise: number,
  duration: number,
  width: number,
) {
  const precision = rise >= 160 ? 30 : rise >= 100 ? 10 : rise >= 48 ? 4 : 1;
  return {
    position: clamp(position + (dx * duration) / Math.max(1, width) / precision, duration),
    precision,
  };
}

export class SeekControls {
  private track: HTMLElement;
  private popup: HTMLElement;
  private picture: HTMLVideoElement;
  private label: HTMLElement;
  private hint: HTMLElement;
  private ruler: HTMLElement;
  private drag?: { id: number; x: number; y: number; value: number; key: string; duration: number };
  private key = '';
  private source = '';
  private generation = 0;
  private hls?: Hls;
  private timer = 0;
  private release = 0;
  private timeout = 0;
  private target = 0;
  private visible = false;
  private failed = false;
  private step = 90;
  private stepSelect: HTMLSelectElement;
  constructor(
    private input: HTMLInputElement,
    private state: () => SeekState,
    private commit: (position: number) => void,
  ) {
    this.track = document.createElement('div');
    this.track.id = 'seek-track';
    input.before(this.track);
    this.track.append(input);
    this.track.insertAdjacentHTML(
      'beforeend',
      `<div id="seek-preview" class="seek-preview" hidden><video id="seek-picture" muted playsinline preload="metadata" disablepictureinpicture></video><strong id="seek-preview-time"></strong><span id="seek-preview-hint"></span><div id="seek-ruler" hidden></div></div>`,
    );
    this.popup = this.track.querySelector('#seek-preview')!;
    this.picture = this.track.querySelector('video')!;
    this.picture.muted = true;
    this.picture.disableRemotePlayback = true;
    this.label = this.track.querySelector('strong')!;
    this.hint = this.track.querySelector('span')!;
    this.ruler = this.track.querySelector('#seek-ruler')!;
    input.title = '悬停预览 · 按住向上拖动可精细定位 · 松手同步';
    input.addEventListener('pointerdown', (e) => this.down(e));
    input.addEventListener('pointermove', (e) => this.move(e));
    input.addEventListener('pointerup', (e) => this.up(e));
    input.addEventListener('pointercancel', () => this.cancel());
    input.addEventListener('lostpointercapture', () => {
      if (this.drag) this.cancel();
    });
    input.addEventListener('pointerleave', () => {
      if (!this.drag) this.hide();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.drag) {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
    });
    input.onchange = () => {
      if (!this.drag) this.submit(Number(input.value));
    };
    for (const name of ['loadedmetadata', 'loadeddata', 'seeked'] as const)
      this.picture.addEventListener(name, () => this.frame());
    this.picture.addEventListener('error', () => this.unavailable());
    const skip = document.createElement('div');
    skip.id = 'skip-controls';
    skip.className = 'skip-controls';
    skip.innerHTML = `<button id="skip-back" type="button" class="icon-button">↶</button><select id="skip-step" aria-label="前后跳转时长" title="前后跳转时长（仅保存本机偏好）">${[10, 30, 60, 90].map((n) => `<option value="${n}">${n}秒</option>`).join('')}</select><button id="skip-forward" type="button" class="icon-button">↷</button>`;
    input.closest('.transport')!.querySelector('#rate')!.after(skip);
    try {
      const saved = Number(localStorage.getItem('vs-skip-step'));
      if ([10, 30, 60, 90].includes(saved)) this.step = saved;
    } catch {}
    const select = skip.querySelector<HTMLSelectElement>('select')!;
    this.stepSelect = select;
    select.value = String(this.step);
    select.onchange = () => {
      const step = Number(select.value);
      if (![10, 30, 60, 90].includes(step)) return;
      this.step = step;
      try {
        localStorage.setItem('vs-skip-step', String(step));
      } catch {}
      this.sync();
    };
    skip.querySelector<HTMLButtonElement>('#skip-back')!.onclick = () =>
      this.submit(this.state().position - this.step);
    skip.querySelector<HTMLButtonElement>('#skip-forward')!.onclick = () =>
      this.submit(this.state().position + this.step);
    window.addEventListener('blur', () => this.cancel());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancel();
    });
  }
  get dragging() {
    return !!this.drag;
  }
  sync() {
    const state = this.state();
    if (this.key !== state.key) {
      this.reset();
      this.key = state.key;
    }
    const available = state.enabled && Number.isFinite(state.duration) && state.duration > 0;
    this.input.classList.toggle('cache-windowed', !!state.window);
    if (state.window) {
      const start = Math.max(
        0,
        Math.min(100, (state.window.start / Math.max(1, state.duration)) * 100),
      );
      const end = Math.max(
        start,
        Math.min(100, (state.window.end / Math.max(1, state.duration)) * 100),
      );
      this.input.style.setProperty('--cache-start', start + '%');
      this.input.style.setProperty('--cache-end', end + '%');
      this.input.setAttribute(
        'aria-valuetext',
        `${time(state.position)}；可跳转 ${time(state.window.start)} 至 ${time(state.window.end)}`,
      );
      this.input.title = '亮色为全员保留的缓存；灰色为未缓存或已清理，不能跳转';
    } else {
      this.input.removeAttribute('aria-valuetext');
      this.input.title = '悬停预览 · 按住向上拖动可精细定位 · 松手同步';
    }
    this.track.hidden = this.input.hidden;
    const skip = document.getElementById('skip-controls')!;
    skip.hidden = this.input.hidden;
    for (const [id, direction] of [
      ['skip-back', '后退'],
      ['skip-forward', '前进'],
    ] as const) {
      const button = skip.querySelector<HTMLButtonElement>('#' + id)!;
      const target = clamp(
        state.position + (id === 'skip-back' ? -this.step : this.step),
        state.duration,
      );
      button.disabled =
        !available ||
        (!!state.window && (target < state.window.start || target >= state.window.end));
      button.title = `${direction} ${this.step} 秒`;
      button.setAttribute('aria-label', button.title);
    }
    this.stepSelect.disabled = !available;
    if (!available) this.reset();
  }
  private submit(value: number) {
    const s = this.state();
    const target = clamp(value, s.duration);
    if (s.window && (target < s.window.start || target >= s.window.end)) {
      this.input.value = String(s.position);
      return;
    }
    if (s.enabled && Number.isFinite(value) && Number.isFinite(s.duration) && s.duration > 0)
      this.commit(clamp(value, s.duration));
  }
  private at(x: number, duration: number) {
    const rect = this.input.getBoundingClientRect();
    return clamp(((x - rect.left - 7) / Math.max(1, rect.width - 14)) * duration, duration);
  }
  private down(event: PointerEvent) {
    const s = this.state();
    if (event.button !== 0 || !event.isPrimary || !s.enabled || this.input.disabled || !s.duration)
      return;
    event.preventDefault();
    this.input.focus({ preventScroll: true });
    this.input.setPointerCapture(event.pointerId);
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      value: this.at(event.clientX, s.duration),
      key: s.key,
      duration: s.duration,
    };
    this.input.closest('.player-shell')!.classList.add('seeking');
    this.show(this.drag.value, event.clientX, 1);
  }
  private move(event: PointerEvent) {
    const s = this.state();
    if (
      !s.enabled ||
      this.input.disabled ||
      this.input.hidden ||
      !Number.isFinite(s.duration) ||
      s.duration <= 0
    )
      return;
    if (this.drag) {
      if (this.drag.id !== event.pointerId) return;
      if (s.key !== this.drag.key || s.duration !== this.drag.duration) {
        this.cancel();
        return;
      }
      const result = scrubStep(
        this.drag.value,
        event.clientX - this.drag.x,
        this.drag.y - event.clientY,
        s.duration,
        this.input.getBoundingClientRect().width - 14,
      );
      this.drag.value = result.position;
      this.drag.x = event.clientX;
      this.show(result.position, event.clientX, result.precision);
    } else if (event.pointerType !== 'touch')
      this.show(this.at(event.clientX, s.duration), event.clientX);
  }
  private up(event: PointerEvent) {
    if (this.drag?.id !== event.pointerId) return;
    event.preventDefault();
    this.move(event);
    const drag = this.drag;
    this.cancel();
    if (drag && drag.key === this.state().key) {
      this.input.value = String(drag.value);
      this.submit(drag.value);
    }
  }
  cancel() {
    const id = this.drag?.id;
    if (this.drag) this.input.value = String(this.state().position);
    this.drag = undefined;
    this.input.closest('.player-shell')?.classList.remove('seeking');
    if (id !== undefined && this.input.hasPointerCapture(id)) this.input.releasePointerCapture(id);
    this.hide();
  }
  reset() {
    this.cancel();
    clearTimeout(this.release);
    this.dispose();
  }
  private show(value: number, x: number, precision?: number) {
    clearTimeout(this.release);
    this.visible = true;
    this.target = value;
    this.popup.hidden = false;
    const rect = this.track.getBoundingClientRect(),
      half = Math.min(100, rect.width / 2);
    this.popup.style.left = Math.max(half, Math.min(rect.width - half, x - rect.left)) + 'px';
    this.label.textContent = time(value);
    this.hint.textContent = precision
      ? precision > 1
        ? `精细 1/${precision} · 松手跳转`
        : '按住上拖，精细定位'
      : '按住上拖，精细定位';
    this.ruler.hidden = !precision || precision === 1;
    this.ruler.textContent = `${time(value - 5)}　　${time(value)}　　${time(value + 5)}`;
    if (this.drag) this.input.value = String(value);
    this.picture.style.visibility = 'hidden';
    clearTimeout(this.timer);
    const cacheWindow = this.state().window;
    if (cacheWindow && (value < cacheWindow.start || value >= cacheWindow.end)) {
      this.dispose();
      this.hint.textContent = '未缓存或已清理，不能跳转';
      return;
    }
    this.timer = window.setTimeout(() => void this.load().catch(() => this.unavailable()), 120);
  }
  private hide() {
    if (!this.visible) return;
    this.visible = false;
    this.popup.hidden = true;
    clearTimeout(this.timer);
    clearTimeout(this.timeout);
    clearTimeout(this.release);
    this.release = window.setTimeout(() => this.dispose(), 1500);
  }
  private unavailable() {
    this.failed = true;
    this.picture.style.visibility = 'hidden';
    this.hint.textContent = '此视频暂不支持画面预览';
  }
  private async load() {
    const source = this.state().source;
    if (!this.visible) return;
    if (!source) {
      this.hint.textContent = '此播放方式仅支持时间预览';
      return;
    }
    if (this.source !== source.src) {
      this.dispose();
      this.source = source.src;
      this.failed = false;
      const generation = this.generation;
      if (source.hls && !this.picture.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js');
        if (generation !== this.generation) return;
        if (!this.visible) {
          this.source = '';
          return;
        }
        if (!Hls.isSupported()) {
          this.unavailable();
          return;
        }
        this.hls = new Hls({
          autoStartLoad: false,
          maxBufferLength: 2,
          maxMaxBufferLength: 4,
          backBufferLength: 0,
          enableWorker: false,
        });
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => this.hls?.startLoad(this.target));
        this.hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) this.unavailable();
        });
        this.hls.attachMedia(this.picture);
        this.hls.loadSource(source.src);
      } else {
        this.picture.src = source.src;
        this.picture.load();
      }
    }
    if (this.failed) {
      this.unavailable();
      return;
    }
    this.hls?.startLoad(this.target);
    this.frame();
    clearTimeout(this.timeout);
    this.timeout = window.setTimeout(() => this.unavailable(), 8000);
  }
  private frame() {
    if (!this.visible || !this.picture.readyState || this.failed) return;
    const window = this.state().window;
    if (window && (this.target < window.start || this.target >= window.end)) return;
    const target = Math.min(this.target, Math.max(0, this.picture.duration - 0.05));
    if (Math.abs(this.picture.currentTime - target) > 0.3) {
      try {
        this.picture.currentTime = target;
      } catch {
        this.unavailable();
      }
      return;
    }
    if (this.picture.seeking || this.picture.readyState < 2) return;
    this.picture.style.visibility = 'visible';
    clearTimeout(this.timeout);
    this.hls?.stopLoad();
  }
  private dispose() {
    clearTimeout(this.timeout);
    this.generation++;
    if (!this.source && !this.hls) return;
    this.hls?.destroy();
    this.hls = undefined;
    this.source = '';
    this.picture.removeAttribute('src');
    this.picture.load();
  }
}
