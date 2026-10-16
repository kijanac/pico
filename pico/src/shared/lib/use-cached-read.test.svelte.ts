import { flushSync } from "svelte";
import { Deferred, Effect, Fiber } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCachedRead } from "./use-cached-read.svelte";

const transport = vi.hoisted(() => ({ tasks: [] as Array<Fiber.RuntimeFiber<unknown, unknown>>, flush: () => {} }));
vi.mock("@/shared/lib/rpc-client", async () => {
  const { Effect, Scheduler } = await import("effect");
  const scheduler = new Scheduler.ControlledScheduler();
  transport.flush = () => { while (scheduler.tasks.buckets.length) scheduler.step(); };
  return { forkRpc: (read: Effect.Effect<unknown, unknown>) => {
    const task = Effect.runFork(read, { scheduler });
    transport.tasks.push(task);
    transport.flush();
    return task;
  } };
});
const tasks = transport.tasks;

const disposers: Array<() => void> = [];
const releases: Array<() => void> = [];
afterEach(async () => {
  disposers.splice(0).forEach((dispose) => dispose());
  releases.splice(0).forEach((release) => release());
  transport.flush();
  await Promise.all(tasks.splice(0).map((task) => Effect.runPromise(Fiber.await(task))));
});

function fixture(options: { capacity: number; revalidate?: boolean; keepPrevious?: boolean } = { capacity: 3, revalidate: true }) {
  let wanted = $state.raw<{ key: string; read: Effect.Effect<string, string> } | null>(null);
  let active = $state(true);
  let read!: ReturnType<typeof useCachedRead<string>>;
  disposers.push($effect.root(() => { read = useCachedRead(() => wanted, () => active, options); }));
  flushSync();
  return {
    read,
    select(key: string | null, effect: Effect.Effect<string, string> = Effect.succeed(key ?? "")) { wanted = key === null ? null : { key, read: effect }; },
    setActive(next: boolean) { active = next; },
    get snapshot() { return { value: read.value, failure: read.failure, loading: read.loading }; },
  };
}

function heldRead() {
  const started = Effect.runSync(Deferred.make<void>());
  const result = Effect.runSync(Deferred.make<string, string>());
  releases.push(() => { Effect.runSync(Deferred.succeed(result, "cleanup")); });
  return {
    read: Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(result)), Effect.uninterruptible),
    started: () => Effect.runPromise(Deferred.await(started)),
    succeed(value: string) { Effect.runSync(Deferred.succeed(result, value)); transport.flush(); },
    fail(error: string) { Effect.runSync(Deferred.fail(result, error)); transport.flush(); },
  };
}

function settle(task = tasks.at(-1)!) {
  transport.flush();
  return Effect.runPromise(Fiber.await(task));
}
async function load(f: ReturnType<typeof fixture>, key: string, effect: Effect.Effect<string, string> = Effect.succeed(key)) {
  f.select(key, effect);
  flushSync();
  await settle();
  flushSync();
}

describe("reactive filesystem reads", () => {
  it("revalidates cached content, retains it on failure and retries without a reactive fetch loop", async () => {
    const f = fixture();
    await load(f, "a");
    const refresh = heldRead();
    f.select("a", refresh.read);
    f.read.retry();
    flushSync();
    await refresh.started();
    expect(f.snapshot).toEqual({ value: "a", failure: null, loading: true });
    refresh.fail("refresh failed");
    await settle();
    flushSync();
    expect(f.snapshot).toEqual({ value: "a", failure: "refresh failed", loading: false });
    f.select("a", Effect.succeed("fresh"));
    f.read.retry();
    flushSync();
    await settle();
    flushSync();
    expect(f.snapshot).toEqual({ value: "fresh", failure: null, loading: false });
    expect(tasks).toHaveLength(3);
  });

  it("skips immutable cache hits, evicts by successful write order and never caches failures", async () => {
    const f = fixture({ capacity: 2, revalidate: false });
    await load(f, "a");
    await load(f, "b");
    await load(f, "a");
    expect(tasks).toHaveLength(2);
    await load(f, "c");
    await load(f, "a", Effect.fail("unavailable"));
    expect(f.snapshot).toEqual({ value: null, failure: "unavailable", loading: false });
    f.read.retry();
    flushSync();
    await settle();
    expect(tasks).toHaveLength(5);
    await load(f, "a", Effect.succeed("historical"));
    expect(f.snapshot).toEqual({ value: "historical", failure: null, loading: false });
  });

  it("keeps previous presentation separate from immutable cache-hit detection", async () => {
    const f = fixture({ capacity: 0, revalidate: false, keepPrevious: true });
    await load(f, "a");
    const next = heldRead();
    f.select("b", next.read);
    flushSync();
    await next.started();
    expect(f.snapshot).toEqual({ value: "a", failure: null, loading: true });
    next.succeed("b");
    await settle();
    expect(f.snapshot).toEqual({ value: "b", failure: null, loading: false });
    f.select(null);
    f.read.showCached();
    expect(f.read.value).toBeNull();
  });

  for (const outcome of ["success", "failure"] as const) {
    it(`rejects stale ${outcome} even before reactive cleanup`, async () => {
      const f = fixture();
      const old = heldRead();
      f.select("old", old.read);
      flushSync();
      await old.started();
      f.select("new");
      if (outcome === "success") old.succeed("obsolete"); else old.fail("obsolete error");
      expect(f.read.value).toBeNull();
      expect(f.read.failure).toBeNull();
      flushSync();
      await settle();
      expect(f.snapshot).toEqual({ value: "new", failure: null, loading: false });
      const revisit = heldRead();
      f.select("old", revisit.read);
      flushSync();
      expect(f.read.value).toBeNull();
      revisit.succeed("current");
      await settle();
    });

    it(`does not let an old ${outcome} or finalizer change a newer pending read`, async () => {
      const f = fixture();
      const old = heldRead();
      f.select("old", old.read);
      flushSync();
      await old.started();
      const oldTask = tasks.at(-1)!;
      const next = heldRead();
      f.select("new", next.read);
      flushSync();
      await next.started();
      if (outcome === "success") old.succeed("obsolete"); else old.fail("obsolete error");
      await settle(oldTask);
      expect(f.snapshot).toEqual({ value: null, failure: null, loading: true });
      next.succeed("current");
      await settle();
      expect(f.snapshot).toEqual({ value: "current", failure: null, loading: false });
    });
  }

  it("invalidates a closing read even when reopening the same key", async () => {
    const f = fixture();
    const old = heldRead();
    f.select("a", old.read);
    flushSync();
    await old.started();
    const oldTask = tasks.at(-1)!;
    f.setActive(false);
    flushSync();
    expect(f.read.loading).toBe(false);
    const next = heldRead();
    f.select("a", next.read);
    flushSync();
    expect(tasks).toHaveLength(1);
    f.setActive(true);
    flushSync();
    await next.started();
    old.succeed("old opening");
    await settle(oldTask);
    expect(f.snapshot).toEqual({ value: null, failure: null, loading: true });
    next.succeed("reopened");
    await settle();
    expect(f.snapshot).toEqual({ value: "reopened", failure: null, loading: false });
  });

  it("projects directory navigation immediately and invalidates the previous read", async () => {
    const f = fixture();
    await load(f, "cached");
    const old = heldRead();
    f.select("old", old.read);
    flushSync();
    await old.started();
    const oldTask = tasks.at(-1)!;
    f.select("cached", Effect.succeed("refreshed"));
    f.read.showCached();
    expect(f.snapshot).toEqual({ value: "cached", failure: null, loading: true });
    old.succeed("obsolete");
    await settle(oldTask);
    flushSync();
    await settle();
    expect(f.read.value).toBe("refreshed");
    f.select(null);
    f.read.showCached();
    expect(f.snapshot).toEqual({ value: null, failure: null, loading: false });
  });

  it("interrupts transport work on disposal without affecting another reader's cache", async () => {
    const f = fixture();
    const other = fixture();
    let interrupted = false;
    const started = Effect.runSync(Deferred.make<void>());
    f.select("a", Deferred.succeed(started, undefined).pipe(
      Effect.zipRight(Effect.never),
      Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; })),
    ));
    flushSync();
    await Effect.runPromise(Deferred.await(started));
    const task = tasks.at(-1)!;
    disposers.shift()!();
    await settle(task);
    expect(interrupted).toBe(true);
    expect(f.read.loading).toBe(false);
    await load(other, "a", Effect.succeed("independent"));
    expect(other.read.value).toBe("independent");
    expect(f.read.value).toBeNull();
  });
});
