import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { popupTarget } = createRequire(import.meta.url)('../desktop/navigation.cjs');

test('原站弹窗不能用广告或非网页地址替换视频，合法选集和站内登录保留', () => {
  const mgn = 'https://www.mgnacg.com/bangumi/193-3-17/';
  for (const target of [
    'https://ad.example/',
    'https://www.mgnacg.com/advert',
    'https://www.mgnacg.com.evil.test/bangumi/193-3-18/',
    'javascript:alert(1)',
    'file:///C:/test',
    'https://user:secret@www.mgnacg.com/bangumi/193-3-18/',
  ])
    assert.equal(popupTarget(mgn, target), null);
  const episode = 'https://www.mgnacg.com/bangumi/193-3-18/';
  assert.equal(popupTarget(mgn, episode), episode);
  const bili = 'https://www.bilibili.com/video/BV13Aa66LEAW/';
  assert.equal(
    popupTarget(bili, 'https://passport.bilibili.com/login'),
    'https://passport.bilibili.com/login',
  );
  assert.equal(popupTarget(bili, 'https://bilibili.com.evil.test/'), null);
  assert.equal(
    popupTarget('https://next.xifanacg.com/anime/151/play/1986', 'https://ad.example/'),
    null,
  );
});
