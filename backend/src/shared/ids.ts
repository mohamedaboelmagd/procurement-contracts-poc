export interface IdGenerator {
  next(prefix: string): string;
}

/** Random, URL-safe ids (Web Crypto exists in Node 20+ and every modern browser). */
export const randomIds: IdGenerator = {
  next: (prefix) => `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
};

/** Predictable ids for tests: rfx_1, rfx_2, … */
export class SequentialIds implements IdGenerator {
  private counters = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }
}
