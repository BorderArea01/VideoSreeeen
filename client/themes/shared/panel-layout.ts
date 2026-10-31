import { icon } from '../../icons';
import { ThemeScope } from '../core/scope';

/** Repositions existing controls only; media and voice objects keep their original identity. */
export class PanelLayout {
  private anchors = new Map<HTMLElement, Comment>();
  private active = false;
  private utilities = document.createElement('div');
  private members = document.createElement('details');
  private voice = document.createElement('details');
  constructor(
    private scope: ThemeScope,
    private options: { moveHeading: boolean },
  ) {
    for (const node of [this.utilities, this.members, this.voice]) scope.own(node);
    scope.attribute(document.documentElement, 'data-theme-layout', 'panels');
    scope.defer(() => {
      this.active = false;
      this.restore();
      for (const anchor of this.anchors.values()) anchor.remove();
      this.anchors.clear();
    });
    this.utilities.className = 'theme-utilities';
    this.members.className = 'theme-members';
    this.members.innerHTML = `<summary>${icon('users', 16)} 成员与连接</summary>`;
    this.voice.className = 'theme-voice';
    this.voice.innerHTML = `<summary><span class="theme-mic">${icon('mic', 26)}</span><span>语音</span>${icon('chevron', 15)}</summary>`;
    for (const panel of [this.voice, this.members]) {
      scope.listen(panel, 'toggle', () => {
        if (!panel.open) return;
        (panel === this.voice ? this.members : this.voice).open = false;
        this.fitPanel(panel);
      });
    }
    scope.listen(document, 'pointerdown', (event) => {
      for (const panel of [this.voice, this.members])
        if (!panel.contains(event.target as Node)) panel.open = false;
    });
    scope.listen(document, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      for (const panel of [this.voice, this.members]) {
        if (!panel.open) continue;
        panel.open = false;
        panel.querySelector('summary')?.focus({ preventScroll: true });
      }
    });
    scope.listen(window, 'resize', () => {
      for (const panel of [this.voice, this.members]) if (panel.open) this.fitPanel(panel);
    });
    scope.listen(document, 'fullscreenchange', () => this.arrange());
    // PageFullscreen emits this event on the player shell without bubbling.
    const player = document.getElementById('player-shell');
    if (player) scope.listen(player, 'cinemachange', () => this.arrange());
  }
  private fitPanel(panel: HTMLDetailsElement) {
    const card = panel.querySelector<HTMLElement>('.members-card');
    if (!card) return;
    card.style.translate = '';
    const rect = card.getBoundingClientRect();
    const offset = Math.max(12 - rect.left, Math.min(0, innerWidth - 12 - rect.right));
    if (offset) card.style.translate = offset + 'px 0';
  }
  setActive(active: boolean) {
    this.active = active;
    this.arrange();
  }
  private restore() {
    for (const [node, anchor] of this.anchors) {
      node.style.translate = '';
      anchor.after(node);
    }
    this.utilities.remove();
    this.voice.remove();
    this.voice.open = this.members.open = false;
  }
  private move(node: HTMLElement | null, parent: HTMLElement) {
    if (!node || node.parentElement === parent) return;
    if (!this.anchors.has(node)) {
      const anchor = document.createComment('appearance-home');
      node.before(anchor);
      this.anchors.set(node, anchor);
    }
    // These portals contain controls, not the video or audio rendering elements.
    parent.append(node);
  }
  private arrange() {
    const visible =
      this.active &&
      !document.body.classList.contains('page-cinema') &&
      !document.fullscreenElement;
    if (!visible) {
      this.restore();
      return;
    }
    const topbar = document.querySelector<HTMLElement>('.topbar')!;
    const workspace = document.querySelector<HTMLElement>('.workspace')!;
    const picker = document.getElementById('playback-picker')!;
    workspace.append(this.utilities);
    picker.append(this.voice);
    this.utilities.append(this.members);
    if (this.options.moveHeading) this.move(document.querySelector('.room-heading'), topbar);
    this.move(document.getElementById('voice-panel'), this.voice);
    this.move(document.querySelector('.sidebar > .members-card:not(.voice-card)'), this.members);
    this.move(document.getElementById('cache-options'), this.utilities);
    this.move(document.getElementById('active-source'), this.utilities);
    this.move(document.querySelector('.screen-foot'), this.utilities);
    this.move(
      document.getElementById('sidebar-invite'),
      document.getElementById('chat-heading-actions')!,
    );
    const help = document.getElementById('link-capability');
    if (help)
      this.scope.attribute(document.getElementById('source-url')!, 'title', help.textContent || '');
  }
}
