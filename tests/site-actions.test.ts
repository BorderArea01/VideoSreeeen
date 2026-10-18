import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteActions } from '../client/site-actions';

test('空闲原站采样先建立基线，第一次真实操作必须发送；后续采样不能重放', () => {
  const actions = new SiteActions();
  const idle = { available: true, frame: 'https://site.test/watch', seq: 0, action: null };
  assert.equal(actions.accept(idle), false);
  assert.equal(actions.accept(idle), false);
  const seek = { ...idle, seq: 1, action: 'seek' };
  assert.equal(actions.accept(seek), true);
  assert.equal(actions.accept(seek), false);
  assert.equal(actions.accept({ ...seek, seq: 2, action: 'pause' }), true);
});

test('离线、换页旧事件、重载重置和无效采样不触发原站操作重放', () => {
  const actions = new SiteActions();
  const current = { available: true, frame: 'a', seq: 4, action: 'seek' };
  assert.equal(actions.accept(current), false);
  assert.equal(actions.accept({ ...current, seq: 5 }), true);
  assert.equal(actions.accept({ ...current, available: false, seq: 6 }), false);
  assert.equal(actions.accept({ ...current, seq: 6 }), true);
  assert.equal(actions.accept({ ...current, frame: 'b', seq: 12 }), false);
  assert.equal(actions.accept({ ...current, frame: 'b', seq: 13 }), true);
  assert.equal(actions.accept({ ...current, frame: 'b', seq: 0, action: null }), false);
  assert.equal(actions.accept({ ...current, frame: 'b', seq: 1 }), true);
  assert.equal(actions.accept({ ...current, seq: NaN }), false);
  actions.reset();
  assert.equal(actions.accept({ ...current, action: null }), false);
  assert.equal(actions.accept({ ...current, seq: 5 }), true);
});
