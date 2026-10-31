export type GlitchVariation = { enabled: boolean; travel: number; size: number };

/** Sample once per entered element/region, never once per pointer event. */
export class HoverGlitch {
  private key: Element | string | undefined;
  private value: GlitchVariation | undefined;
  enter(key: Element | string): GlitchVariation {
    if (this.key !== key || !this.value) {
      this.key = key;
      this.value = {
        enabled: Math.random() < 0.5,
        travel: 0.7 + Math.random() * 0.6,
        size: 0.8 + Math.random() * 0.4,
      };
    }
    return this.value;
  }
  reset() {
    this.key = this.value = undefined;
  }
}
