import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createApp } from '../server/index';
import { IMAGE_LIMIT } from '../server/images';

test('chat attachments: multi-megabyte original, bounded snapshots, membership, expiry and byte limits', async () => {
  const app = createApp();
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const { room, seat } = app.rooms.create('u', { readyState: 1, send() {}, close() {} });
  const headers = { Authorization: `Bearer ${seat.resume}`, 'X-Member-Id': seat.id };
  const data = Buffer.concat([
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    Buffer.alloc(2 * 1024 * 1024, 0),
  ]);
  let phase = 0;
  const request = async (...args: Parameters<typeof fetch>) => {
    phase++;
    try {
      return await fetch(...args);
    } catch (e) {
      throw new Error(`image phase ${phase}`, { cause: e });
    }
  };
  try {
    assert.equal(
      (await request(`${origin}/images/${room.code}`, { method: 'POST', body: data })).status,
      403,
    );
    assert.equal(
      (
        await request(`${origin}/images/${room.code}`, {
          method: 'POST',
          headers,
          body: '<svg onload="alert(1)"/>',
        })
      ).status,
      415,
    );
    const upload = await request(`${origin}/images/${room.code}`, {
      method: 'POST',
      headers,
      body: data,
    });
    assert.equal(upload.status, 201, await upload.clone().text());
    const { id } = (await upload.json()) as any;
    const downloaded = await request(`${origin}/images/${room.code}/${id}`);
    assert.equal(downloaded.headers.get('Content-Type'), 'image/gif');
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await downloaded.arrayBuffer()))
        .digest('hex'),
      createHash('sha256').update(data).digest('hex'),
    );
    assert.ok(JSON.stringify(app.rooms.snapshot(room)).length < 4000);
    assert.equal(
      (
        await request(`${origin}/images/${room.code}`, {
          method: 'POST',
          headers,
          body: Buffer.alloc(IMAGE_LIMIT + 1),
        })
      ).status,
      413,
    );
    room.chat = [];
    assert.equal((await request(`${origin}/images/${room.code}/${id}`)).status, 404);
    app.rooms.disconnect(room, seat, seat.socket!, true);
    assert.equal(
      (await request(`${origin}/images/${room.code}`, { method: 'POST', headers, body: data }))
        .status,
      403,
    );
  } finally {
    await app.close();
  }
});
