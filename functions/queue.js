export class SerialQueue {
  constructor({ minIntervalMs = 0, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.now = now;
    this.sleep = sleep;
    this.tail = Promise.resolve();
    this.lastStart = -Infinity;
  }

  run(task) {
    const result = this.tail.then(async () => {
      const wait = this.lastStart + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      return task();
    });

    this.tail = result.catch(() => {});
    return result;
  }
}
