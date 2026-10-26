import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../functions/cache.js';

test('TtlCache hết hạn theo thời gian', () => {
  let now = 0;
  const cache = new TtlCache({ now: () => now });
  cache.set('key', 'value', 1_000);

  assert.equal(cache.get('key'), 'value');
  now = 1_001;
  assert.equal(cache.get('key'), undefined);
});

test('TtlCache loại bỏ mục cũ nhất khi vượt giới hạn', () => {
  const cache = new TtlCache({ maxEntries: 2 });
  cache.set('a', 1, 1_000);
  cache.set('b', 2, 1_000);
  cache.set('c', 3, 1_000);

  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

test('getOrLoad gộp các lần gọi trùng key', async () => {
  const cache = new TtlCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return 'value';
  };

  const [first, second] = await Promise.all([
    cache.getOrLoad('key', 1_000, loader),
    cache.getOrLoad('key', 1_000, loader),
  ]);

  assert.equal(first, 'value');
  assert.equal(second, 'value');
  assert.equal(calls, 1);
});

test('getOrLoad không cache lỗi', async () => {
  const cache = new TtlCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    if (calls === 1) throw new Error('fail');
    return 'ok';
  };

  await assert.rejects(() => cache.getOrLoad('key', 1_000, loader));
  assert.equal(await cache.getOrLoad('key', 1_000, loader), 'ok');
  assert.equal(calls, 2);
});
