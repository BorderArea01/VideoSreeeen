/** Local layout only: keep the chat, player and voice nodes alive while collapsed. */
export class ChatSidebar {
  private buttons: HTMLElement[];
  constructor(
    private sidebar: HTMLElement,
    private resized: () => void,
  ) {
    this.buttons = ['chat-toggle', 'chat-collapse', 'chat-restore'].map((id) =>
      document.getElementById(id)!,
    );
    for (const button of this.buttons) {
      button.setAttribute('aria-controls', sidebar.id);
      button.onclick = () => this.setHidden(!sidebar.hidden);
    }
    // Page fullscreen also owns temporary sidebar visibility and restores it on exit.
    new MutationObserver(() => this.update()).observe(sidebar, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    this.update();
  }
  private setHidden(hidden: boolean) {
    const inside = this.sidebar.contains(document.activeElement);
    this.sidebar.hidden = hidden;
    this.update();
    if (hidden && inside) {
      const target = document.body.classList.contains('page-cinema')
        ? document.getElementById('page-sidebar-toggle')!
        : document.getElementById('chat-restore')!;
      target.focus({ preventScroll: true });
    } else if (!hidden) document.getElementById('chat-collapse')!.focus({ preventScroll: true });
    this.resized();
  }
  private update() {
    const hidden = this.sidebar.hidden;
    document.body.classList.toggle('chat-hidden', hidden);
    document.getElementById('chat-restore')!.hidden = !hidden;
    for (const button of this.buttons) {
      const label = hidden ? '展开聊天室' : '收起聊天室';
      button.setAttribute('aria-expanded', String(!hidden));
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }
}
