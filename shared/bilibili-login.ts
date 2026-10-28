// Preserve the original official QR target. No third-party QR service or
// guessed redirect; the site currently returns the account.bilibili.com route.
export function bilibiliLoginQr(raw: unknown, expectedKey?: string) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    const allowed =
      (url.origin === 'https://account.bilibili.com' &&
        url.pathname === '/h5/account-h5/auth/scan-web') ||
      (url.origin === 'https://passport.bilibili.com' &&
        url.pathname === '/h5-app/passport/login/scan');
    const key = url.searchParams.get('qrcode_key');
    return allowed &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.searchParams.getAll('qrcode_key').length === 1 &&
      /^[a-z0-9]{16,128}$/i.test(key ?? '') &&
      (!expectedKey || expectedKey === key)
      ? url
      : null;
  } catch {
    return null;
  }
}
