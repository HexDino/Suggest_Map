export class SlidingWindowLimiter {
  constructor({ windowMs = 60_000, max = 60, maxKeys = 5_000, now = Date.now } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this.now = now;
    this.hits = new Map();
  }

  take(key) {
    const current = this.now();
    const cutoff = current - this.windowMs;
    const hits = (this.hits.get(key) || []).filter((time) => time > cutoff);
    if (hits.length >= this.max) {
      this.hits.set(key, hits);
      return false;
    }
    hits.push(current);
    this.hits.set(key, hits);

    if (this.hits.size > this.maxKeys) {
      for (const [otherKey, times] of this.hits) {
        if (!times.some((time) => time > cutoff)) this.hits.delete(otherKey);
        if (this.hits.size <= this.maxKeys) break;
      }
      while (this.hits.size > this.maxKeys) {
        this.hits.delete(this.hits.keys().next().value);
      }
    }

    return true;
  }
}
