import { randomUUID } from 'node:crypto';

import { RTT_INTERVAL, RTT_TTL } from '../shared/latency';
export { RTT_INTERVAL, RTT_TTL };
export interface ProbeState {
  nonce?: string;
  probeAt?: number;
}
export function startProbe(state: ProbeState, now: number): string | null {
  if (
    state.probeAt !== undefined &&
    (now - state.probeAt < RTT_INTERVAL || (state.nonce && now - state.probeAt < RTT_TTL))
  )
    return null;
  state.nonce = randomUUID();
  state.probeAt = now;
  return state.nonce;
}
export function finishProbe(state: ProbeState, nonce: string, now: number): number | null {
  if (!state.nonce || state.nonce !== nonce || state.probeAt === undefined) return null;
  const elapsed = now - state.probeAt;
  state.nonce = undefined;
  return elapsed >= 0 && elapsed < RTT_TTL ? Math.round(elapsed) : null;
}
