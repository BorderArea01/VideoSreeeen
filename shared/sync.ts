export type Correction = { kind: 'ignore' | 'rate' | 'seek'; target: number; rate: number };
export function positionAt(
  position: number,
  paused: boolean,
  rate: number,
  elapsedMs: number,
): number {
  return Math.max(0, position + (paused ? 0 : (Math.max(0, elapsedMs) * rate) / 1000));
}
export function reconcile(
  local: number,
  target: number,
  rate: number,
  paused: boolean,
  explicitSeek = false,
  catchingUp = false,
): Correction {
  const drift = target - local;
  if (
    explicitSeek ||
    (paused && Math.abs(drift) > 0.12) ||
    Math.abs(drift) > 1.2 * Math.max(1, rate)
  )
    return { kind: 'seek', target, rate };
  if (!paused && Math.abs(drift) > (catchingUp ? 0.06 : 0.3) * Math.max(1, rate))
    return {
      kind: 'rate',
      target,
      rate: Math.max(0.25, Math.min(4, rate * (1 + Math.sign(drift) * 0.06))),
    };
  return { kind: 'ignore', target, rate };
}
