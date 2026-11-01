/** Fullscreen interaction is local; it never changes playback or room state. */
export class FullscreenIdle {
  private timer = 0;
  private pressed = false;
  private keyboard = false;
  private pointer?: { x: number; y: number; type: string };
  constructor(
    private shell: HTMLElement,
    private playing: () => boolean,
  ) {
    const pointer = (event: PointerEvent) => {
      if (
        event.type === 'pointermove' &&
        this.pointer?.x === event.clientX &&
        this.pointer.y === event.clientY &&
        this.pointer.type === event.pointerType
      )
        return;
      this.pointer = { x: event.clientX, y: event.clientY, type: event.pointerType };
      this.keyboard = false;
      if (event.type === 'pointerdown') this.pressed = true;
      if (event.type === 'pointerup') this.pressed = false;
      this.wake();
    };
    document.addEventListener('pointermove', pointer);
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('pointerup', pointer);
    document.addEventListener('pointercancel', () => {
      this.pressed = false;
      this.schedule();
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.isComposing ||
          ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'].includes(
            event.key,
          ) ||
          /^(AudioVolume|Media)/.test(event.key)
        )
          return;
        const inControls =
          event.target instanceof Element && !!event.target.closest('.transport, .stage-tools');
        this.keyboard =
          event.key === 'Tab' ||
          (inControls &&
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key));
        this.wake();
      },
      true,
    ); // See Escape before a settings panel handles and stops it.
    document.addEventListener('focusin', () => {
      // Browser/programmatic focus restoration is not a new user action.
      if (this.keyboard) this.wake();
      else this.schedule();
    });
    document.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node && this.shell.contains(event.relatedTarget)))
        this.keyboard = false;
      this.schedule();
    });
    const modeChanged = () => {
      this.keyboard = false;
      this.pressed = false;
      this.wake();
    };
    document.addEventListener('fullscreenchange', modeChanged);
    shell.addEventListener('cinemachange', modeChanged);
    window.addEventListener('blur', () => {
      this.pressed = false;
      this.keyboard = false;
      this.schedule();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pressed = false;
        this.keyboard = false;
      }
      this.schedule();
    });
  }
  private fullscreen() {
    return (
      document.fullscreenElement === this.shell || document.body.classList.contains('page-cinema')
    );
  }
  wake() {
    this.shell.classList.remove('player-idle');
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.fullscreen() || this.shell.classList.contains('player-idle')) return;
    this.timer = window.setTimeout(() => {
      const focused = document.activeElement;
      if (
        !this.fullscreen() ||
        !this.playing() ||
        this.pressed ||
        this.shell.classList.contains('seeking') ||
        document.querySelector('dialog[open], #player-settings[open]') ||
        (this.keyboard && focused instanceof HTMLElement && this.shell.contains(focused)) ||
        (focused instanceof HTMLElement && !!focused.closest('#sidebar'))
      )
        return;
      this.shell.classList.add('player-idle');
      // Release a passive button focus left by pointer activation or browser
      // restoration. Real keyboard navigation above keeps its visible focus.
      if (
        !this.keyboard &&
        focused instanceof HTMLElement &&
        focused.matches('button, summary, a') &&
        focused.closest('.transport, .stage-tools')
      )
        focused.blur();
    }, 1000);
  }
}
