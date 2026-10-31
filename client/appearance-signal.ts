const buttons = [
  '#room-button',
  '#hero-create',
  '#create-button',
  '#join-button',
  '#source-form button',
  '#choose-link',
  '#choose-screen',
  '#choose-file',
  '#local-video-button',
  '#broadcast-screen',
  '#broadcast-site',
  '#voice-join',
  '#voice-mic',
  '#send-button',
].join(',');
const panels = '.source-card, .chat-panel, .members-card:not(.voice-card)';
const layer = '[data-signal-layer]';

/** Local CSS decoration. Owns no media, room state, inputs, or audio resources. */
export class SignalScene {
  private active = false;
  private field = document.createElement('div');
  private timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private last = new WeakMap<HTMLElement, number>();
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private contrast = matchMedia('(forced-colors: active)');
  private observer = new MutationObserver((records) => {
    if (!this.active) return;
    const dirty = new Set<HTMLElement>();
    let scan = false;
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || target.closest(layer)) continue;
      const changed = [...record.addedNodes, ...record.removedNodes];
      if (changed.length && changed.every((node) => node instanceof Element && node.matches(layer)))
        continue;
      scan = true;
      const button = target.closest<HTMLElement>('.signal-control');
      if (button) dirty.add(button);
    }
    if (scan) this.refresh(dirty);
  });
  constructor() {
    this.field.id = 'signal-field';
    this.field.setAttribute('aria-hidden', 'true');
    this.field.innerHTML =
      '<span class="signal-field-base"></span><span class="signal-field-inverse"></span><span class="signal-field-counter"></span>';
    this.field.hidden = true;
    document.body.prepend(this.field);
    document.addEventListener(
      'pointerover',
      (event) => {
        if (!(event.target instanceof Element) || event.pointerType === 'touch') return;
        const target = event.target.closest<HTMLElement>('.signal-control');
        if (
          target &&
          !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))
        )
          this.burst(target);
      },
      { passive: true },
    );
    document.addEventListener('focusin', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('.signal-control'))
        this.burst(event.target);
    });
    // Native click also covers keyboard activation. Hover/focus decorate only
    // the control or panel; the page background flashes on button activation.
    document.addEventListener(
      'click',
      (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        const button = event.target.closest(
          'button,[role="button"],summary,a.button,input[type="button"],input[type="submit"],input[type="reset"]',
        );
        if (button && !button.matches(':disabled,[aria-disabled="true"]')) this.burst(this.field);
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'pointermove',
      (event) => {
        if (this.suspended() || !(event.target instanceof Element) || event.pointerType === 'touch')
          return;
        if (
          event.target.closest(
            '.player-shell, dialog, input, textarea, select, .daylight-voice[open], .daylight-members[open]',
          )
        )
          return;
        const panel = event.target.closest<HTMLElement>('.signal-panel');
        if (panel) {
          const rect = panel.getBoundingClientRect(),
            y = event.clientY - rect.top;
          if (y < 20 || y > rect.height - 20) this.burst(panel);
        }
      },
      { passive: true },
    );
    for (const name of ['visibilitychange', 'fullscreenchange', 'cinemachange', 'pagehide'])
      document.addEventListener(name, () => this.clear(), true);
    this.motion.addEventListener('change', () => this.clear());
    this.contrast.addEventListener('change', () => this.clear());
  }
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.clear();
    this.field.hidden = !active;
    this.observer.disconnect();
    if (active) {
      this.refresh();
      this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      for (const el of document.querySelectorAll('.signal-control, .signal-panel'))
        el.classList.remove('signal-control', 'signal-panel');
      for (const el of document.querySelectorAll(layer)) el.remove();
    }
  }
  private suspended() {
    return (
      !this.active ||
      document.hidden ||
      this.motion.matches ||
      this.contrast.matches ||
      document.body.classList.contains('page-cinema') ||
      !!document.fullscreenElement
    );
  }
  private clear() {
    for (const [el, timer] of this.timers) {
      clearTimeout(timer);
      el.classList.remove('signal-active');
    }
    this.timers.clear();
  }
  private burst(el: HTMLElement) {
    if (this.suspended() || this.timers.has(el) || el.matches(':disabled') || !el.checkVisibility())
      return;
    if (el.closest('.player-shell, .daylight-voice[open], .daylight-members[open]')) return;
    if (el !== this.field) {
      const film = document.getElementById('player-shell')?.getBoundingClientRect(),
        rect = el.getBoundingClientRect();
      if (
        film &&
        rect.left < film.right &&
        rect.right > film.left &&
        rect.top < film.bottom &&
        rect.bottom > film.top
      )
        return;
    }
    if (performance.now() - (this.last.get(el) ?? -Infinity) < 1100) return;
    this.last.set(el, performance.now());
    el.classList.add('signal-active');
    this.timers.set(
      el,
      setTimeout(() => {
        el.classList.remove('signal-active');
        this.timers.delete(el);
      }, 950),
    );
  }
  private refresh(dirty = new Set<HTMLElement>()) {
    for (const button of document.querySelectorAll<HTMLElement>(buttons)) {
      if (
        button.closest('.player-shell') ||
        button.querySelector('input,textarea,select,button,audio,video,iframe,canvas')
      )
        continue;
      button.classList.add('signal-control');
      if (button.querySelector(':scope > [data-signal-layer]') && !dirty.has(button)) continue;
      for (const old of button.querySelectorAll(':scope > [data-signal-layer]')) old.remove();
      const original = [...button.childNodes];
      for (const name of ['signal-copy', 'signal-counter']) {
        const copy = document.createElement('span');
        copy.className = name;
        copy.dataset.signalLayer = '';
        copy.setAttribute('aria-hidden', 'true');
        copy.inert = true;
        for (const node of original) copy.append(node.cloneNode(true));
        for (const node of copy.querySelectorAll('[id],[name]')) {
          node.removeAttribute('id');
          node.removeAttribute('name');
        }
        button.append(copy);
      }
    }
    for (const panel of document.querySelectorAll<HTMLElement>(panels)) {
      if (panel.closest('.player-shell')) continue;
      panel.classList.add('signal-panel');
      if (panel.querySelector(':scope > .signal-panel-fragments')) continue;
      const copy = document.createElement('span');
      copy.className = 'signal-panel-fragments';
      copy.dataset.signalLayer = '';
      copy.setAttribute('aria-hidden', 'true');
      copy.inert = true;
      copy.innerHTML =
        '<span class="signal-panel-inverse"></span><span class="signal-panel-counter"></span>';
      panel.append(copy);
    }
  }
}
