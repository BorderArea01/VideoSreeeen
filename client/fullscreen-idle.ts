/** Fullscreen interaction is local; it never changes playback or room state. */
export class FullscreenIdle {
  private timer = 0;
  private pressed = false;
  private keyboard = false;
  constructor(
    private shell: HTMLElement,
    private playing: () => boolean,
  ) {
    const wake = (event?: Event) => {
      if (event instanceof PointerEvent) this.keyboard = false;
      if (event?.type === 'keydown') this.keyboard = true;
      if (event?.type === 'pointerdown') this.pressed = true;
      if (event?.type === 'pointerup' || event?.type === 'pointercancel') this.pressed = false;
      this.wake();
    };
    document.addEventListener('pointermove', wake);
    document.addEventListener('pointerdown', wake);
    document.addEventListener('pointerup', wake);
    document.addEventListener('pointercancel', wake);
    document.addEventListener('keydown', wake);
    document.addEventListener('focusin', wake);
    document.addEventListener('fullscreenchange', wake);
    shell.addEventListener('cinemachange', wake);
    window.addEventListener('blur', () => {
      this.pressed = false;
      this.keyboard = false;
      this.wake();
    });
  }
  private fullscreen() {
    return (
      document.fullscreenElement === this.shell || document.body.classList.contains('page-cinema')
    );
  }
  wake() {
    clearTimeout(this.timer);
    this.shell.classList.remove('player-idle');
    if (!this.fullscreen()) return;
    this.timer = window.setTimeout(() => {
      const focused = document.activeElement;
      if (
        !this.fullscreen() ||
        !this.playing() ||
        this.pressed ||
        this.shell.classList.contains('seeking') ||
        document.querySelector('dialog[open], #player-settings[open]') ||
        (this.keyboard &&
          focused instanceof HTMLElement &&
          focused.matches(':focus-visible') &&
          this.shell.contains(focused)) ||
        (focused instanceof HTMLElement && !!focused.closest('#sidebar'))
      )
        return;
      this.shell.classList.add('player-idle');
    }, 1000);
  }
}
