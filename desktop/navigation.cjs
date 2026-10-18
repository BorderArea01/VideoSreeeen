// New-window links must never let an advert replace the original video page.
module.exports.popupTarget = function popupTarget(current, target) {
  try {
    const from = new URL(current),
      next = new URL(target);
    if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) return null;
    if (['www.mgnacg.com', 'mgnacg.com'].includes(from.hostname))
      return next.protocol === 'https:' &&
        ['www.mgnacg.com', 'mgnacg.com'].includes(next.hostname) &&
        !next.port &&
        /^\/bangumi\/\d+-\d+-\d+\/$/.test(next.pathname)
        ? next.href
        : null;
    if (from.hostname === 'bilibili.com' || from.hostname.endsWith('.bilibili.com'))
      return next.protocol === 'https:' &&
        !next.port &&
        (next.hostname === 'bilibili.com' || next.hostname.endsWith('.bilibili.com'))
        ? next.href
        : null;
    return next.origin === from.origin ? next.href : null;
  } catch {
    return null;
  }
};
