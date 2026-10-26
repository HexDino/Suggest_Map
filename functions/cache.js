export class TtlCache {
  constructor({ maxEntries = 300, now = Date.now } = {}) {
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
    this.inflight = new Map();
  }

  get(key) {
    const item = this.entries.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, item);
    return item.value;
  }

  set(key, value, ttlMs) {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
  }

  async getOrLoad(key, ttlMs, loader) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    if (this.inflight.has(key)) return this.inflight.get(key);

    const pending = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (value !== undefined) this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, pending);
    return pending;
  }

  clear() {
    this.entries.clear();
    this.inflight.clear();
  }
}
