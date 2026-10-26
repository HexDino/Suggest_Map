export class SlidingWindowLimiter {
  constructor({ windowMs = 60_000, max = 60, now = Date.now } = {}) {
    this.windowMs = windowMs;
    this.max = max;
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
    return true;
  }
}
