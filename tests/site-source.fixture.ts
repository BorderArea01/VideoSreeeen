import { createHash } from 'node:crypto';
const page = 'https://www.mgnacg.com/bangumi/193-3-17/';
const source = 'https://r2.jzacg.com/example/episode.mp4?Authorization=public-fixture-token';
export async function playerFixture(video = source) {
  const digest = createHash('md5')
    .update('ABCDEFGHIJ' + 'Mknacg123321')
    .digest('hex');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(digest.slice(16)),
    'AES-CBC',
    false,
    ['encrypt'],
  );
  const bytes = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: new TextEncoder().encode(digest.slice(0, 16)) },
    key,
    new TextEncoder().encode(video),
  );
  return `<meta charset="UTF-8" id="now_9876543210"><meta name="viewport" id="now_JIHGFEDCBA"><script>var config={"url":${JSON.stringify(Buffer.from(bytes).toString('base64'))},unrelated:'not JSON'};player(config);</script>`;
}
export function metadataFixture(html: string) {
  const requests: string[] = [];
  return {
    requests,
    async fetch(url: string) {
      requests.push(url);
      return new Response(
        url === page
          ? '<title>番剧第16话-橘子动漫</title><script>var player_aaaa=' +
              JSON.stringify({
                id: '193',
                sid: 3,
                nid: 17,
                points: 0,
                trysee: 0,
                from: '4_',
                url: 'opaque%3D',
              }) +
              ';</script>'
          : url.includes('playerconfig.js')
            ? 'MacPlayerConfig.player_list=' +
              JSON.stringify({
                '4_': { parse: 'https://play.mknacg.top:8585/cloudplay/ccxl.php?url=' },
              }) +
              ';'
            : html,
      );
    },
  };
}
