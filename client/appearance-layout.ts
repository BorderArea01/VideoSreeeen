import { icon } from './icons';

/** Repositions existing controls only; media and voice objects keep their original identity. */
export class DaylightLayout {
  private anchors = new Map<HTMLElement, Comment>();
  private active = false;
  private utilities = document.createElement('div');
  private members = document.createElement('details');
  private voice = document.createElement('details');
  constructor() {
    this.utilities.className = 'daylight-utilities';
    this.members.className = 'daylight-members';
    this.members.innerHTML = `<summary>${icon('users', 16)} 成员与连接</summary>`;
    this.voice.className = 'daylight-voice';
    this.voice.innerHTML = `<summary><span class="daylight-mic">${icon('mic', 26)}</span><span>语音</span>${icon('chevron', 15)}</summary>`;
    document.addEventListener('fullscreenchange', () => this.arrange());
    // PageFullscreen emits this event on the player shell without bubbling.
    document.getElementById('player-shell')?.addEventListener('cinemachange', () => this.arrange());
  }
  setActive(active: boolean) {
    this.active = active;
    this.arrange();
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
      for (const [node, anchor] of this.anchors) anchor.after(node);
      this.utilities.remove();
      this.voice.remove();
      this.voice.open = this.members.open = false;
      return;
    }
    const topbar = document.querySelector<HTMLElement>('.topbar')!;
    const workspace = document.querySelector<HTMLElement>('.workspace')!;
    const picker = document.getElementById('playback-picker')!;
    workspace.append(this.utilities);
    picker.append(this.voice);
    this.utilities.append(this.members);
    this.move(document.querySelector('.room-heading'), topbar);
    this.move(document.getElementById('voice-panel'), this.voice);
    this.move(document.querySelector('.sidebar > .members-card:not(.voice-card)'), this.members);
    this.move(document.getElementById('cache-options'), this.utilities);
    this.move(document.getElementById('active-source'), this.utilities);
    this.move(document.querySelector('.screen-foot'), this.utilities);
    this.move(document.getElementById('sidebar-invite'), document.getElementById('chat-drag')!);
    const help = document.getElementById('link-capability');
    if (help) document.getElementById('source-url')!.title = help.textContent || '';
  }
}
