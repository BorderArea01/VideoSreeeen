export interface Episode {
  url: string;
  title: string;
}

/** Only accept an original site's next episode in the same series and line. */
export function nextEpisode(current: string, candidate: unknown, title = '下一集'): Episode | null {
  if (typeof candidate !== 'string' || !candidate || candidate.length > 2048) return null;
  try {
    const from = new URL(current),
      to = new URL(candidate, from);
    if (
      to.protocol !== 'https:' ||
      to.origin !== from.origin ||
      to.username ||
      to.password ||
      to.hash
    )
      return null;
    let valid = false;
    if (from.hostname === 'next.xifanacg.com') {
      const a = /^\/anime\/(\d+)\/play\/(\d+)\/?$/.exec(from.pathname);
      const b = /^\/anime\/(\d+)\/play\/(\d+)\/?$/.exec(to.pathname);
      valid = !!(
        a &&
        b &&
        a[1] === b[1] &&
        a[2] !== b[2] &&
        from.searchParams.get('source') === to.searchParams.get('source')
      );
    } else if (['www.mgnacg.com', 'mgnacg.com'].includes(from.hostname)) {
      const a = /^\/bangumi\/(\d+)-(\d+)-(\d+)\/$/.exec(from.pathname);
      const b = /^\/bangumi\/(\d+)-(\d+)-(\d+)\/$/.exec(to.pathname);
      valid = !!(
        a &&
        b &&
        a[1] === b[1] &&
        a[2] === b[2] &&
        Number(b[3]) > Number(a[3]) &&
        !to.search
      );
    } else if (from.hostname === 'www.bilibili.com') {
      valid =
        /^\/video\/BV[A-Za-z0-9]+\/$/.test(from.pathname) &&
        from.pathname === to.pathname &&
        /^\d+$/.test(to.searchParams.get('p') ?? '') &&
        Number(to.searchParams.get('p')) > Number(from.searchParams.get('p') || 1);
    }
    return valid ? { url: to.href, title: title.trim().slice(0, 120) || '下一集' } : null;
  } catch {
    return null;
  }
}

/** Read a JSON string field from normal HTML / Next.js serialized page data. */
export function pageString(html: string, field: string): string | null {
  const text = html.replace(/\\"/g, '"');
  const value = new RegExp('"' + field + '"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")').exec(text)?.[1];
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
