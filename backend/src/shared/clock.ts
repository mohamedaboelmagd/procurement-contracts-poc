export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Deterministic clock for tests and the browser demo ("move time forward"). */
export class FixedClock implements Clock {
  private current: number;
  constructor(start: Date | string) {
    this.current = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.current);
  }
  advanceDays(days: number): void {
    this.current += days * 86_400_000;
  }
  advanceMs(ms: number): void {
    this.current += ms;
  }
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export function isoDate(iso: string): string {
  return iso.slice(0, 10);
}
