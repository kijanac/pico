import { untrack } from "svelte";
import { Effect, Fiber } from "effect";
import { forkRpc, type PicoClient } from "@/shared/lib/rpc-client";

type ReadRequest<A> = { key: string; read: Effect.Effect<A, unknown, PicoClient> };

export function useCachedRead<A>(request: () => ReadRequest<A> | null, active: () => boolean, options: { capacity: number; revalidate?: boolean }) {
  let value = $state.raw<A | null>(null);
  let failure = $state.raw<unknown>(null);
  let loading = $state(false);
  let revision = $state(0);
  let generation = 0;
  const recent = new Map<string, A>();

  function showCached() {
    untrack(() => {
      generation += 1;
      const key = request()?.key;
      value = key === undefined ? null : recent.get(key) ?? null;
      failure = null;
      loading = key !== undefined && (options.revalidate !== false || value === null);
    });
  }

  $effect(() => {
    if (!active()) return;
    revision;
    const wanted = request();
    showCached();
    if (!wanted || !untrack(() => loading)) return;
    const started = generation;
    const current = () => generation === started && active() && request()?.key === wanted.key;
    const task = untrack(() => forkRpc(wanted.read.pipe(
      Effect.tap((result) => Effect.sync(() => {
        if (!current()) return;
        recent.delete(wanted.key);
        recent.set(wanted.key, result);
        while (recent.size > options.capacity) recent.delete(recent.keys().next().value!);
        value = result;
      })),
      Effect.catchAll((error) => Effect.sync(() => { if (current()) failure = error; })),
      Effect.ensuring(Effect.sync(() => { if (current()) loading = false; })),
    )));
    return () => { generation += 1; loading = false; Effect.runFork(Fiber.interrupt(task)); };
  });

  return {
    get value() { return value; },
    get failure() { return failure; },
    get loading() { return loading; },
    showCached,
    retry() { revision += 1; },
  };
}
