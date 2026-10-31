// Optional asset maintenance, never executed by build or the running website.
// Download fixed OFL Fontsource subsets; runtime requests remain same-origin.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const version = '5.3.0';
const target = 'client/assets/fonts';
const licenses = 'client/public/licenses/fonts';
const headings = '聊天室房间语音播放方式共同本地视频缓存成员连接紫电噪讯邀请放映室多人观影';
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
  ['chakra-petch', 'Signal Tech', 600, '600.css'],
  ['zcool-qingke-huangyou', 'Signal Tube', 400, 'index.css'],
]) {
  const base = `https://cdn.jsdelivr.net/npm/@fontsource/${name}@${version}/`;
  const css = (await get(base + entry)).toString();
  const license = await get(base + 'LICENSE');
  if (!license.toString().includes('SIL OPEN FONT LICENSE')) throw new Error('Unverified license');
  await writeFile(`${licenses}/${name}-OFL.txt`, license);
  const wanted = new Set([...headings].map((c) => c.codePointAt(0)));
  for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const block = match[1];
    const file = /url\(\.\/files\/([^()]+\.woff2)\)/.exec(block)?.[1];
    const range = /unicode-range:\s*([^;]+)/.exec(block)?.[1];
    if (!file || !range) continue;
    let subset = range;
    if (name === 'chakra-petch') {
      if (file !== `chakra-petch-latin-${weight}-normal.woff2`) continue;
    } else {
      const points = [...wanted].filter((point) =>
        range.split(',').some((part) => {
          const [lo, hi = lo] = part
            .trim()
            .slice(2)
            .split('-')
            .map((s) => parseInt(s, 16));
          return point >= lo && point <= hi;
        }),
      );
      if (!points.length) continue;
      subset = points.map((p) => `U+${p.toString(16)}`).join(',');
      for (const p of points) wanted.delete(p);
    }
    const bytes = await get(base + 'files/' + file);
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
  if (name !== 'chakra-petch' && wanted.size) throw new Error('Missing heading characters');
}
await writeFile(
  'client/signal-fonts.css',
  '/* Self-hosted OFL fonts; regenerate with scripts/fetch-theme-fonts.mjs. */\n' +
    faces.join('\n') +
    '\n',
);
await writeFile(
  `${target}/SOURCES.json`,
  JSON.stringify({ version, headings, fonts: records }, null, 2) + '\n',
);
console.log(
  JSON.stringify({ files: records.length, bytes: records.reduce((sum, r) => sum + r.bytes, 0) }),
);
