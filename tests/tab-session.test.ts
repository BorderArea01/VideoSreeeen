import assert from 'node:assert/strict';
import test from 'node:test';
import { TabSessions } from '../client/tab-session';

test('tab recovery validates room/server, survives reload, and never takes an opener copy on fresh navigation', () => {
  const data = new Map<string, string>();
  const sessions = new TabSessions({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  });
  const record = {
    server: 'https://room.example',
    invite: 'ABC234:' + 'a'.repeat(32),
    name: '观众',
    resume: 'b'.repeat(32),
  };
  sessions.save(record);
  assert.deepEqual(sessions.restore('reload'), record);
  assert.deepEqual(sessions.restore('reload', 'https://room.example/#' + record.invite), record);
  assert.equal(sessions.restore('reload', 'https://other.example/#' + record.invite), null);
  sessions.save(record);
  assert.equal(sessions.restore('reload', 'XYZ234:' + 'a'.repeat(32)), null);
  sessions.save(record);
  assert.equal(sessions.restore('navigate'), null);
  assert.equal(sessions.restore('reload'), null);
  sessions.save(record);
  sessions.clear();
  assert.equal(sessions.restore('reload'), null);
  data.set('vs-room-session', '{"server":"javascript:alert(1)"}');
  assert.equal(sessions.restore('reload'), null);
});
