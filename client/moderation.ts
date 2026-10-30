import type { ClientMessage, Snapshot } from '../shared/protocol';

export class RoomModeration {
  private room: Snapshot | null = null;
  private me = '';
  private connected = false;
  private panel: HTMLElement;
  private deadline = 0;
  private text: HTMLElement;
  constructor(
    before: HTMLElement,
    private send: (message: Extract<ClientMessage, { type: 'kick-vote' }>) => unknown,
  ) {
    this.panel = document.createElement('section');
    this.panel.className = 'kick-vote';
    this.panel.id = 'kick-vote';
    this.panel.hidden = true;
    this.panel.innerHTML =
      '<strong id="kick-vote-title"></strong><span id="kick-vote-count" role="status"></span><div><button id="kick-vote-yes" class="button soft small">同意移出</button><button id="kick-vote-no" class="button soft small">反对</button><button id="kick-vote-withdraw" class="text-button">撤回票</button></div>';
    before.before(this.panel);
    this.text = this.panel.querySelector('#kick-vote-count')!;
    for (const action of ['yes', 'no', 'withdraw'] as const)
      this.panel.querySelector<HTMLButtonElement>('#kick-vote-' + action)!.onclick = () => {
        if (this.connected && this.room?.kickVote)
          this.send({ type: 'kick-vote', action, voteId: this.room.kickVote.id });
      };
    setInterval(() => this.tick(), 1000);
  }
  start(target: string) {
    if (this.connected) this.send({ type: 'kick-vote', action: 'start', target });
  }
  configure(room: Snapshot | null, me: string, connected: boolean) {
    this.room = room;
    this.me = me;
    this.connected = connected;
    const vote = room?.kickVote;
    this.panel.hidden = !vote;
    if (!vote) return;
    this.deadline = performance.now() + vote.remainingMs;
    const target = room.members.find((member) => member.id === vote.target)?.name ?? '该成员';
    this.panel.querySelector('#kick-vote-title')!.textContent = `票选移出 ${target}`;
    for (const action of ['yes', 'no', 'withdraw'] as const) {
      const button = this.panel.querySelector<HTMLButtonElement>('#kick-vote-' + action)!;
      button.disabled = !connected || (action === 'yes' && vote.target === me);
      button.setAttribute(
        'aria-pressed',
        String(
          action === 'yes' ? vote.yes.includes(me) : action === 'no' ? vote.no.includes(me) : false,
        ),
      );
    }
    this.tick();
  }
  private tick() {
    const vote = this.room?.kickVote;
    if (!vote) return;
    const seconds = Math.max(0, Math.ceil((this.deadline - performance.now()) / 1000));
    this.text.textContent = `同意 ${vote.yes.length} / ${vote.required} · 反对 ${vote.no.length} · ${seconds} 秒`;
    if (!seconds)
      for (const button of this.panel.querySelectorAll('button')) button.disabled = true;
  }
}
