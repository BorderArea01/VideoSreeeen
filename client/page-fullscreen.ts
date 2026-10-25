import { icon } from './icons';

/** Changes layout only. Never recreates a player or requests OS fullscreen. */
export class PageFullscreen {
  private active = false;
  private sidebarHidden = false;
  private scroll = { x: 0, y: 0 };
  constructor(
    stage: HTMLElement,
    transport: HTMLElement,
    private sidebar: HTMLElement,
    private toggle: HTMLButtonElement,
    private sideToggle: HTMLButtonElement,
    private resized: () => void,
  ) {
    const shell = document.createElement('div');
    shell.id = 'player-shell';
    shell.className = 'player-shell';
    stage.before(shell);
    shell.append(stage, transport);
    toggle.onclick = () => this.set(!this.active);
    sideToggle.onclick = () => {
      if (!this.active) return;
      sidebar.hidden = !sidebar.hidden;
      sideToggle.setAttribute('aria-expanded', String(!sidebar.hidden));
      resized();
    };
    document.addEventListener('keydown', (event) => {
      if (
        event.key !== 'Escape' ||
        !this.active ||
        event.isComposing ||
        document.fullscreenElement ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      this.set(false);
    });
    this.update();
  }
  exit() {
    this.set(false);
  }
  private set(active: boolean) {
    if (active === this.active) return;
    if (active) {
      this.sidebarHidden = this.sidebar.hidden;
      this.scroll = { x: scrollX, y: scrollY };
      this.sidebar.hidden = true;
    } else this.sidebar.hidden = this.sidebarHidden;
    this.active = active;
    document.body.classList.toggle('page-cinema', active);
    this.update();
    if (!active) {
      window.scrollTo(this.scroll.x, this.scroll.y);
      this.toggle.focus({ preventScroll: true });
    }
    this.resized();
  }
  private update() {
    const label = this.active ? '退出网页全屏' : '网页全屏';
    this.toggle.title = label;
    this.toggle.setAttribute('aria-label', label);
    this.toggle.setAttribute('aria-pressed', String(this.active));
    this.toggle.innerHTML = icon('window', 19);
    this.sideToggle.hidden = !this.active;
    this.sideToggle.setAttribute('aria-expanded', String(this.active && !this.sidebar.hidden));
  }
}
