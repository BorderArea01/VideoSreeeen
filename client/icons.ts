const paths: Record<string, string> = {
  film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7M4 12h12"/>',
  link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" transform="translate(1 0) scale(.9)"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0Z"/><path d="M7 9h9M7 13h6"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-3-5"/>',
  signal: '<path d="M4 19v-3M9 19v-7M14 19V8M19 19V4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  play: '<path d="m8 4 13 8-13 8Z"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  'volume-off': '<path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6M22 9l-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  send: '<path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1 3 4 3 4-3 4-3M8 8h.01M16 8h.01"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m21 15-6-6L3 21"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  exit: '<path d="M10 3H3v18h7m4-14 5 5-5 5m-6-5h12"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  shield: '<path d="m12 2 8 4v6c0 6-8 10-8 10S4 18 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
};
export const icon = (name: string, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.film}</svg>`;
