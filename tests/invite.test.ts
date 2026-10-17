import assert from 'node:assert/strict';
import test from 'node:test';
import { invitationServer, parseInvite, serverOrigin } from '../shared/invite';

const code = 'ABC234:' + 'x'.repeat(32);
test('invitations carry the target server while bare codes use the chosen default', () => {
  assert.equal(
    invitationServer(`https://friends.example/#${code}`, 'https://mine.example'),
    'https://friends.example',
  );
  assert.equal(invitationServer(code, 'https://mine.example/'), 'https://mine.example');
  assert.equal(parseInvite('ABC234'), null);
  for (const input of [
    `https://user:secret@friends.example/#${code}`,
    `https://friends.example/path#${code}`,
    `https://friends.example/?tracking=1#${code}`,
  ])
    assert.equal(parseInvite(input), null);
});
test('server settings reject credentials and silently discarded address components', () => {
  assert.equal(serverOrigin(' http://192.168.1.2:8787/ '), 'http://192.168.1.2:8787');
  for (const value of [
    'invalid',
    'ftp://example.com',
    'https://user:secret@example.com',
    'https://example.com/api',
    'https://example.com/?a=1',
    'https://example.com/#room',
  ])
    assert.throws(() => serverOrigin(value));
});
