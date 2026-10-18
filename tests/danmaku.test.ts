import test from 'node:test';
import assert from 'node:assert/strict';
import { DanmakuFeed } from '../client/danmaku';
const chat = (id: string, text?: string) => ({ id, text, memberId: 'a', name: 'A', at: 1 });
test('聊天弹幕只取新文字与 Emoji，加入、重连、重复状态不重放历史或图片', () => {
  const feed = new DanmakuFeed();
  const history = [chat('old', '历史')];
  assert.deepEqual(feed.take('room', history), []);
  const fresh = [
    ...history,
    chat('new', '🍿 👨‍👩‍👧‍👦'),
    { ...chat('image'), image: 'data:image/png;base64,AA==' },
  ];
  assert.deepEqual(feed.take('room', fresh), [{ text: '🍿 👨‍👩‍👧‍👦' }]);
  assert.deepEqual(feed.take('room', fresh), []);
  assert.deepEqual(feed.take('room', history), []);
  assert.deepEqual(feed.take('room', fresh), []);
  feed.reset();
  assert.deepEqual(feed.take('room', [...fresh, chat('offline', '离线期间')]), []);
  assert.deepEqual(feed.take('other', fresh), []);
});
