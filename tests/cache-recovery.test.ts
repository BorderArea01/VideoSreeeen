import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheRecovery, CacheTransferError, cacheWait } from '../client/cache-recovery';

test('transfer retries keep verified state, then wait for explicit continuation without restarting', async () => {
  const state = new Map([[0, 'verified']]);
  const recovery = new CacheRecovery(),
    abort = new AbortController();
  let calls = 0,
    paused = 0,
    resumed = 0,
    online = false;
  const result = recovery.run(
    async () => {
      calls++;
      if (!online) throw new CacheTransferError('temporary');
      state.set(1, 'verified');
      return 'complete';
    },
    abort.signal,
    () => paused++,
    () => resumed++,
  );
  while (!recovery.waiting) await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 3);
  assert.equal(paused, 1);
  assert.deepEqual([...state], [[0, 'verified']]);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 3);
  online = true;
  assert.equal(recovery.resume(), true);
  assert.equal(await result, 'complete');
  assert.equal(resumed, 1);
  assert.equal(recovery.waiting, false);
  assert.equal(recovery.resume(), false);
});

test('cancelled pending permission waits cannot revive after a media change', async () => {
  const recovery = new CacheRecovery(),
    controller = new AbortController();
  const operations = [1, 2].map(() =>
    recovery.run(
      async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
      controller.signal,
      () => {},
      () => assert.fail('cancelled operation resumed'),
    ),
  );
  const settled = Promise.all(operations.map((p) => assert.rejects(p, { name: 'AbortError' })));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(recovery.waiting, true);
  controller.abort();
  await settled;
  assert.equal(recovery.waiting, false);
  assert.equal(recovery.resume(), false);
});

test('content/range validation is not reclassified as a retryable network failure', async () => {
  const recovery = new CacheRecovery();
  let calls = 0;
  await assert.rejects(
    recovery.run(
      async () => {
        calls++;
        throw new Error('range mismatch');
      },
      new AbortController().signal,
      () => assert.fail('invalid data retained as reusable'),
      () => {},
    ),
    /range mismatch/,
  );
  assert.equal(calls, 1);
  const stopped = new AbortController();
  stopped.abort();
  assert.throws(() => cacheWait(1000, stopped.signal), { name: 'AbortError' });
});
