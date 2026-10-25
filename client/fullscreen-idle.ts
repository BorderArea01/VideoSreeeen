/** Fullscreen interaction is local; it never changes playback or room state. */
export class FullscreenIdle {
  private timer = 0;
  private overControls = false;
  constructor(
    private shell: HTMLElement,
    private playing: () => boolean,
  ) {
    const wake = (event?: Event) => {
      if (event instanceof PointerEvent)
        this.overControls = !!(event.target as Element).closest('.transport');
      this.wake();
    };
    document.addEventListener('pointermove', wake);
    document.addEventListener('pointerdown', wake);
    document.addEventListener('pointerup', wake);
    document.addEventListener('keydown', wake);
    document.addEventListener('focusin', wake);
    document.addEventListener('fullscreenchange', wake);
    shell.addEventListener('cinemachange', wake);
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
        this.overControls ||
        this.shell.classList.contains('seeking') ||
        document.querySelector('dialog[open]') ||
        (focused instanceof HTMLElement &&
          focused.matches(':focus-visible') &&
          this.shell.contains(focused)) ||
        (document.body.classList.contains('page-cinema') &&
          !document.getElementById('sidebar')!.hidden)
      )
        return;
      this.shell.classList.add('player-idle');
    }, 2500);
  }
}
