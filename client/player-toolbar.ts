import { icon } from './icons';

/** Group existing controls once. No player replacement or room operation. */
export class PlayerToolbar {
  private settings: HTMLDetailsElement;
  private timing: HTMLElement;
  private volume: HTMLElement;
  private speed: HTMLElement;
  private step: HTMLElement;
  constructor(private transport: HTMLElement) {
    const get = (id: string) => document.getElementById(id)!;
    const left = document.createElement('div');
    left.className = 'transport-primary';
    this.timing = document.createElement('span');
    this.timing.className = 'player-time';
    this.timing.append(get('position'), document.createTextNode(' / '), get('duration'));
    const right = document.createElement('div');
    right.className = 'transport-tools';
    this.settings = document.createElement('details');
    this.settings.id = 'player-settings';
    this.settings.innerHTML = `<summary title="播放设置" aria-label="播放设置">${icon('settings', 18)}</summary><div class="player-settings-panel"><label id="player-volume-setting"><span>视频音量</span></label><label id="player-speed-setting"><span>播放速度</span></label><label id="player-step-setting"><span>跳转时长</span></label></div>`;
    this.volume = this.settings.querySelector('#player-volume-setting')!;
    this.speed = this.settings.querySelector('#player-speed-setting')!;
    this.step = this.settings.querySelector('#player-step-setting')!;
    this.volume.append(get('video-volume'));
    this.speed.append(get('rate'));
    this.step.append(get('skip-step'));
    get('skip-back').innerHTML = icon('backward', 18);
    get('skip-forward').innerHTML = icon('forward', 18);
    left.append(get('play-button'), get('skip-controls'), this.timing);
    right.append(
      get('video-sound'),
      this.settings,
      get('danmaku-native-toggle'),
      get('page-sidebar-toggle'),
      get('page-fullscreen'),
      get('fullscreen'),
    );
    transport.append(left, right);
    const wake = () => transport.closest('.player-shell')!.dispatchEvent(new Event('cinemachange'));
    this.settings.addEventListener('toggle', wake);
    document.addEventListener('pointerdown', (e) => {
      if (!this.settings.contains(e.target as Node)) this.settings.open = false;
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || e.isComposing || !this.settings.open) return;
        e.preventDefault();
        e.stopPropagation();
        this.settings.open = false;
        this.settings.querySelector('summary')!.focus();
      },
      true,
    );
    document.addEventListener('fullscreenchange', () => {
      this.settings.open = false;
    });
  }
  sync() {
    const get = (id: string) => document.getElementById(id)!;
    this.timing.hidden = get('position').hidden;
    this.volume.hidden = get('video-sound').hidden;
    this.speed.hidden = get('rate').hidden;
    this.step.hidden = get('skip-controls').hidden;
    this.settings.hidden = this.volume.hidden && this.speed.hidden && this.step.hidden;
    if (this.settings.hidden) this.settings.open = false;
  }
}
