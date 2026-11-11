import { ConcurrencyError } from './errors.js';

/**
 * Re-run a whole read-modify-write when an optimistic-concurrency conflict is detected,
 * with a small jittered backoff so competing writers don't collide in lockstep.
 */
export async function withConflictRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ConcurrencyError) || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, Math.random() * 4 * i));
    }
  }
}
