export const PROTOCOL = 1;
export function serverOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('请填写完整的服务器地址，例如 https://videosreeeen.pages.dev');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('服务器地址需为 HTTP/HTTPS 根地址，不带路径、参数或账户信息');
  return url.origin;
}

// Complete links carry the room's server; bare codes use the chosen default.
// Never persist a friend's server as the user's own server preference.
export function invitationServer(value: string, fallback: string): string {
  if (!parseInvite(value)) throw new Error('请粘贴朋友发来的完整邀请链接或邀请码');
  return /^https?:/.test(value.trim()) ? new URL(value.trim()).origin : serverOrigin(fallback);
}
export function parseInvite(value: string): { code: string; token: string } | null {
  let input = value.trim();
  try {
    if (/^https?:/.test(input)) {
      const url = new URL(input);
      if (url.username || url.password || url.pathname !== '/' || url.search) return null;
      input = url.hash.slice(1);
    }
  } catch {
    return null;
  }
  const match = /^([A-Z2-9]{6}):([A-Za-z0-9_-]{24,64})$/.exec(input);
  return match ? { code: match[1], token: match[2] } : null;
}
