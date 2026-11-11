/**
 * Zustand store for the static demo. It owns the in-memory platform (the real services), the current
 * persona and a `tick` that components use to re-query after every mutation.
 */
import { create } from 'zustand';
import { createInMemoryPlatform } from '@core/platform';
import { DEMO_ACTORS, seedDemo, type PersonaKey } from '@core/seed';
import { FixedClock } from '@core/shared/clock';
import type { Actor } from '@core/shared/actor';
import type { DomainEvent } from '@core/shared/events';

type Platform = ReturnType<typeof createInMemoryPlatform>;

export interface Toast {
  kind: 'ok' | 'error';
  text: string;
  id: number;
}

interface DemoState {
  platform: Platform | null;
  clock: FixedClock | null;
  persona: PersonaKey;
  tick: number;
  events: DomainEvent[];
  toast: Toast | null;
  daysAdvanced: number;
  init: () => Promise<void>;
  setPersona: (p: PersonaKey) => void;
  /** Run a mutation as the current persona; refreshes views and turns errors into a toast. */
  act: <T>(label: string, fn: (p: Platform, actor: Actor) => Promise<T>) => Promise<T | undefined>;
  advanceDays: (n: number) => void;
  dismissToast: () => void;
}

let toastId = 0;
let started = false;

export const useDemo = create<DemoState>((set, get) => ({
  platform: null,
  clock: null,
  persona: 'buyer',
  tick: 0,
  events: [],
  toast: null,
  daysAdvanced: 0,

  async init() {
    if (started) return; // React StrictMode runs effects twice in dev
    started = true;
    const clock = new FixedClock(new Date());
    const platform = createInMemoryPlatform({ clock, log: () => {} });
    platform.bus.tap((e) => set((s) => ({ events: [e, ...s.events].slice(0, 200) })));
    await seedDemo(platform);
    set({ platform, clock, tick: get().tick + 1 });
  },

  setPersona(persona) {
    set({ persona, tick: get().tick + 1 });
  },

  async act(label, fn) {
    const { platform, persona } = get();
    if (!platform) return undefined;
    try {
      const result = await fn(platform, DEMO_ACTORS[persona]);
      set((s) => ({ tick: s.tick + 1, toast: { kind: 'ok', text: label, id: ++toastId } }));
      return result;
    } catch (err) {
      set((s) => ({ tick: s.tick + 1, toast: { kind: 'error', text: err instanceof Error ? err.message : String(err), id: ++toastId } }));
      return undefined;
    }
  },

  advanceDays(n) {
    get().clock?.advanceDays(n);
    set((s) => ({ tick: s.tick + 1, daysAdvanced: s.daysAdvanced + n, toast: { kind: 'ok', text: `Clock moved forward ${n} days`, id: ++toastId } }));
  },

  dismissToast() {
    set({ toast: null });
  },
}));

export const useActor = () => DEMO_ACTORS[useDemo((s) => s.persona)];
