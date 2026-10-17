export const PROTOCOL = 1;
export function parseInvite(value: string): { code: string; token: string } | null {
  let input = value.trim();
  try {
    if (/^https?:/.test(input)) input = new URL(input).hash.slice(1);
  } catch {
    return null;
  }
  const match = /^([A-Z2-9]{6}):([A-Za-z0-9_-]{24,64})$/.exec(input);
  return match ? { code: match[1], token: match[2] } : null;
}
