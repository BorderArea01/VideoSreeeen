// Optional asset maintenance, never executed by build or the running website.
// Download fixed OFL Fontsource subsets; runtime requests remain same-origin.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const version = '5.3.0';
const target = 'client/assets/fonts';
const licenses = 'client/public/licenses/fonts';
const previous = JSON.parse(await readFile(`${target}/SOURCES.json`, 'utf8').catch(() => '{}'));
await mkdir(target, { recursive: true });
await mkdir(licenses, { recursive: true });
const records = [];
const faces = [];
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
for (const [name, family, weight, entry] of [
  ['chakra-petch', 'Signal Tech', 400, '400.css'],
  ['chakra-petch', 'Signal Tech', 600, '600.css'],
  ['zcool-qingke-huangyou', 'Signal Tube', 400, 'index.css'],
]) {
  const base = `https://cdn.jsdelivr.net/npm/@fontsource/${name}@${version}/`;
  const css = (await get(base + entry)).toString();
  const license = await get(base + 'LICENSE');
  if (!license.toString().includes('SIL OPEN FONT LICENSE')) throw new Error('Unverified license');
  await writeFile(`${licenses}/${name}-OFL.txt`, license);
  for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const block = match[1];
    const file = /url\(\.\/files\/([^()]+\.woff2)\)/.exec(block)?.[1];
    const range = /unicode-range:\s*([^;]+)/.exec(block)?.[1];
    if (!file || !range) continue;
    // Preserve native color emoji; this face supplies text, not pictographs.
    const subset = range
      .split(',')
      .filter((part) => {
        const point = parseInt(part.trim().slice(2), 16);
        return point < 0x1f000 || point >= 0x20000;
      })
      .join(',');
    if (!subset) continue;
    if (name === 'chakra-petch') {
      if (file !== `chakra-petch-latin-${weight}-normal.woff2`) continue;
    }
    let bytes = await readFile(`${target}/${file}`).catch(() => null);
    const prior = previous.version === version && previous.fonts?.find((f) => f.file === file);
    if (!bytes || !prior || createHash('sha256').update(bytes).digest('hex') !== prior.sha256)
      bytes = await get(base + 'files/' + file);
    if (bytes.subarray(0, 4).toString() !== 'wOF2') throw new Error('Invalid WOFF2');
    await writeFile(`${target}/${file}`, bytes);
    records.push({
      family,
      file,
      url: base + 'files/' + file,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      license: 'OFL-1.1',
    });
    faces.push(
      `@font-face {font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('./assets/fonts/${file}') format('woff2');unicode-range:${subset};}`,
    );
  }
}
await writeFile(
  'client/signal-fonts.css',
  '/* Self-hosted OFL fonts; regenerate with scripts/fetch-theme-fonts.mjs. */\n' +
    faces.join('\n') +
    '\n',
);
await writeFile(
  `${target}/SOURCES.json`,
  JSON.stringify(
    {
      version,
      coverage: 'Full upstream text subsets; color emoji use system fallback',
      fonts: records,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({ files: records.length, bytes: records.reduce((sum, r) => sum + r.bytes, 0) }),
);
