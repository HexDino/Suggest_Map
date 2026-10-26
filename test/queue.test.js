import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue } from '../server/queue.js';
import { SlidingWindowLimiter } from '../server/rate-limit.js';

test('SerialQueue giãn cách thời điểm bắt đầu các tác vụ', async () => {
  let now = 0;
  const sleeps = [];
  const queue = new SerialQueue({
    minIntervalMs: 300,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });

  const starts = [];
  await Promise.all(
    [1, 2, 3].map(() =>
      queue.run(async () => {
        starts.push(now);
        return true;
      }),
    ),
  );

  assert.deepEqual(starts, [0, 300, 600]);
  assert.deepEqual(sleeps, [300, 300]);
});

test('SerialQueue tiếp tục chạy sau một tác vụ lỗi', async () => {
  const queue = new SerialQueue();
  await assert.rejects(() => queue.run(async () => {
    throw new Error('fail');
  }));
  assert.equal(await queue.run(async () => 'ok'), 'ok');
});

test('SlidingWindowLimiter chặn khi vượt ngưỡng và mở lại sau cửa sổ', () => {
  let now = 0;
  const limiter = new SlidingWindowLimiter({ windowMs: 1_000, max: 2, now: () => now });

  assert.equal(limiter.take('ip'), true);
  assert.equal(limiter.take('ip'), true);
  assert.equal(limiter.take('ip'), false);
  assert.equal(limiter.take('other'), true);

  now = 1_001;
  assert.equal(limiter.take('ip'), true);
});
