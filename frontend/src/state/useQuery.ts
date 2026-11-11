import { useEffect, useState } from 'react';
import { useDemo } from './store';
import type { Actor } from '@core/shared/actor';
import { DEMO_ACTORS } from '@core/seed';

type Platform = NonNullable<ReturnType<typeof useDemo.getState>['platform']>;

/** Re-runs a read as the current persona whenever the store ticks (after any mutation). */
export function useQuery<T>(fn: (p: Platform, actor: Actor) => Promise<T>, deps: unknown[] = []): { data: T | undefined; error: string | null } {
  const platform = useDemo((s) => s.platform);
  const persona = useDemo((s) => s.persona);
  const tick = useDemo((s) => s.tick);
  const [state, setState] = useState<{ data: T | undefined; error: string | null }>({ data: undefined, error: null });
  useEffect(() => {
    if (!platform) return;
    let live = true;
    fn(platform, DEMO_ACTORS[persona]).then(
      (data) => live && setState({ data, error: null }),
      (err: unknown) => live && setState({ data: undefined, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [platform, persona, tick, ...deps]);
  return state;
}
