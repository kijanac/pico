/**
 * Guards against stale async results: when several overlapping calls race, only the
 * newest one should be allowed to commit its result.
 *
 * Replaces the hand-rolled `const id = ++counter; …await…; if (id !== counter) return;`
 * pattern with a single primitive so the edge handling lives in one place.
 *
 *   const load = createLatest();
 *   async function refresh() {
 *     const token = load.begin();
 *     const next = await fetch();
 *     if (!load.isCurrent(token)) return; // a newer refresh() started; drop this result
 *     data = next;
 *   }
 */
export interface Latest {
  /** Start a new attempt, invalidating every prior token. Returns this attempt's token. */
  begin(): number;
  /** True while `token` is the most recent one handed out by `begin()`. */
  isCurrent(token: number): boolean;
}

export function createLatest(): Latest {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (token) => token === current,
  };
}
