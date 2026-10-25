import assert from 'node:assert/strict';
import test from 'node:test';
import { scrubStep } from '../client/seek-controls';

test('upward precision changes preserve position and scale incremental motion', () => {
  const coarse = scrubStep(500, 100, 0, 3600, 1000);
  assert.equal(coarse.position, 860);
  assert.deepEqual(scrubStep(coarse.position, 0, 110, 3600, 1000), {
    position: 860,
    precision: 10,
  });
  assert.deepEqual(scrubStep(860, 100, 110, 3600, 1000), { position: 896, precision: 10 });
  assert.deepEqual(scrubStep(860, -100, 170, 3600, 1000), { position: 848, precision: 30 });
  assert.equal(scrubStep(0, -100, 0, 3600, 1000).position, 0);
  assert.equal(scrubStep(3590, 100, 0, 3600, 1000).position, 3600);
});
