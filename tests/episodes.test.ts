import test from 'node:test';
import assert from 'node:assert/strict';
import { nextEpisode, pageString } from '../shared/episodes';
import { allowedSiteMetadata, readNextEpisode } from '../server/site-source';

const xifan = 'https://next.xifanacg.com/anime/151/play/1986?source=xfy2';
const mgn = 'https://www.mgnacg.com/bangumi/193-3-17/';
test('下一集只接受原站明确给出的同番同线路地址，不猜集数', () => {
  assert.equal(
    nextEpisode(xifan, '/anime/151/play/2000?source=xfy2')?.url,
    'https://next.xifanacg.com/anime/151/play/2000?source=xfy2',
  );
  for (const url of [
    null,
    '',
    'javascript:alert(1)',
    '//evil.test/anime/151/play/1987?source=xfy2',
    '/anime/152/play/1987?source=xfy2',
    '/anime/151/play/1987?source=other',
    xifan,
  ])
    assert.equal(nextEpisode(xifan, url), null);
  assert.equal(
    nextEpisode(mgn, '/bangumi/193-3-18/')?.url,
    'https://www.mgnacg.com/bangumi/193-3-18/',
  );
  for (const url of ['/bangumi/193-2-18/', '/bangumi/194-3-18/', '/bangumi/193-3-16/', '/ads'])
    assert.equal(nextEpisode(mgn, url), null);
});
test('静态解析原站下一集元数据及最后一集，不执行脚本', () => {
  const state = { nextHref: '/anime/151/play/1987?source=xfy2', nextLabel: '第 5 集' };
  const html =
    '<script>self.__next_f.push([1,' + JSON.stringify(JSON.stringify(state)) + '])</script>';
  assert.equal(pageString(html, 'nextHref'), state.nextHref);
  assert.equal(readNextEpisode(xifan, html)?.title, '第 5 集');
  assert.equal(readNextEpisode(xifan, '{"nextHref":null}'), null);
  assert.equal(
    readNextEpisode(mgn, 'player_aaaa={"link_next":"/bangumi/193-3-18/"}; evil()')?.url,
    'https://www.mgnacg.com/bangumi/193-3-18/',
  );
  assert.equal(readNextEpisode(mgn, 'player_aaaa={"link_next":""}'), null);
  const bili = 'https://www.bilibili.com/video/BV13Aa66LEAW/';
  const data =
    '__INITIAL_STATE__={"videoData":{"pages":[{"page":1,"part":"开篇"},{"page":2,"part":"后篇"}]}}';
  assert.equal(readNextEpisode(bili, data)?.url, bili + '?p=2');
  assert.equal(readNextEpisode(bili + '?p=2', data), null);
});
test('剧集元数据请求保持原站路径白名单，不开放通用代理', () => {
  const al = 'https://next.xifanacg.com/anime/3434/play/203799?source=AL';
  assert.equal(
    readNextEpisode(
      al,
      JSON.stringify({ nextHref: '/anime/3434/play/203800?source=AL', nextLabel: '第 2 集' }),
    )?.url,
    'https://next.xifanacg.com/anime/3434/play/203800?source=AL',
  );
  assert.equal(nextEpisode(al, '/anime/3434/play/203800?source=xfy2'), null);
  for (const url of [xifan, al, mgn, 'https://www.bilibili.com/video/BV13Aa66LEAW/?p=2'])
    assert.ok(allowedSiteMetadata(url));
  for (const url of [
    'https://next.xifanacg.com/admin',
    xifan + '&redirect=http://127.0.0.1',
    al + '&redirect=http://127.0.0.1',
    'https://www.bilibili.com/account',
    'http://next.xifanacg.com/anime/151/play/1986?source=xfy2',
  ])
    assert.equal(allowedSiteMetadata(url), false);
});
