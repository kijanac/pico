import { Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { createAsyncResource } from "./async-resource";

function fixture(fetch: (key: string) => Effect.Effect<number, string>) {
  let active = "a";
  let owner = "a";
  let value = 0;
  const resource = createAsyncResource({
    fetch,
    get: () => owner === active ? value : null,
    isActive: (key) => key === active,
    commit: (key, next) => { owner = key; value = next; },
  });
  return { resource, get value() { return value; }, activate: (key: string) => { active = key; } };
}

const gate = <A, E = never>() => Effect.runSync(Deferred.make<A, E>());

function heldRead() {
  const started = gate<void>();
  const result = gate<number, string>();
  let calls = 0;
  const state = fixture(() => Effect.suspend(() => {
    calls += 1;
    return Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(result)));
  }));
  return { ...state, state, started, result, get calls() { return calls; } };
}

describe("async resources", () => {
  it("does not run a read until its Effect is executed", () => {
    const state = heldRead();
    state.resource.load("a");
    expect(state.calls).toBe(0);
  });

  it("starts an initial read before activation and commits only after its session becomes active", async () => {
    const state = heldRead();
    state.state.activate("none");
    const read = Effect.runFork(state.resource.load("a"));
    await Effect.runPromise(Deferred.await(state.started));
    state.state.activate("a");
    await Effect.runPromise(Deferred.succeed(state.result, 1));
    expect(await Effect.runPromise(Fiber.join(read))).toBe(1);
    expect(state.state.value).toBe(1);
  });

  it("coalesces overlapping reads", async () => {
    const state = heldRead();
    const first = Effect.runFork(state.resource.load("a"));
    await Effect.runPromise(Deferred.await(state.started));
    const second = Effect.runFork(state.resource.load("a"));
    await Effect.runPromise(Effect.yieldNow());
    expect(state.calls).toBe(1);
    await Effect.runPromise(Deferred.succeed(state.result, 1));
    expect(await Effect.runPromise(Fiber.join(first))).toBe(1);
    expect(await Effect.runPromise(Fiber.join(second))).toBe(1);
  });

  it("does not let an older read overwrite a set", async () => {
    const state = heldRead();
    const read = Effect.runFork(state.resource.load("a"));
    await Effect.runPromise(Deferred.await(state.started));
    state.resource.set("a", 2);
    await Effect.runPromise(Deferred.succeed(state.result, 1));
    expect(await Effect.runPromise(Fiber.join(read))).toBeNull();
    expect(state.state.value).toBe(2);
  });

  it("does not let an older refresh undo a successful mutation", async () => {
    const state = heldRead();
    const read = Effect.runFork(state.resource.load("a"));
    await Effect.runPromise(Deferred.await(state.started));
    await Effect.runPromise(state.resource.update("a", 2, Effect.succeed(3)));
    await Effect.runPromise(Deferred.succeed(state.result, 1));
    expect(await Effect.runPromise(Fiber.join(read))).toBeNull();
    expect(state.state.value).toBe(3);
  });

  it("waits for a mutation before reading again", async () => {
    const result = gate<number, string>();
    const started = gate<void>();
    let reads = 0;
    const state = fixture(() => Effect.sync(() => { reads += 1; return 3; }));
    const mutation = Effect.runFork(state.resource.update("a", 2,
      Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(result)))));
    await Effect.runPromise(Deferred.await(started));
    const read = Effect.runFork(state.resource.load("a"));
    await Effect.runPromise(Effect.yieldNow());
    expect(reads).toBe(0);
    await Effect.runPromise(Deferred.succeed(result, 3));
    await Effect.runPromise(Fiber.join(mutation));
    expect(await Effect.runPromise(Fiber.join(read))).toBe(3);
    expect(reads).toBe(1);
  });

  it("rolls back a failed mutation", async () => {
    const state = fixture(() => Effect.succeed(0));
    await Effect.runPromiseExit(state.resource.update("a", 2, Effect.fail("failed")));
    expect(state.value).toBe(0);
  });

  it("does not roll back a newer successful mutation", async () => {
    const result = gate<number, string>();
    const started = gate<void>();
    const state = fixture(() => Effect.succeed(0));
    const older = Effect.runFork(state.resource.update("a", 2,
      Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(result)))));
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(state.resource.update("a", 4, Effect.succeed(4)));
    await Effect.runPromise(Deferred.fail(result, "older failure"));
    expect(Exit.isFailure(await Effect.runPromise(Fiber.await(older)))).toBe(true);
    expect(state.value).toBe(4);
  });

  it("allows another session to load without waiting for the outgoing mutation", async () => {
    const result = gate<number, string>();
    const started = gate<void>();
    const state = fixture((key) => Effect.succeed(key === "a" ? 3 : 10));
    const mutation = Effect.runFork(state.resource.update("a", 2,
      Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(result)))));
    await Effect.runPromise(Deferred.await(started));
    state.activate("b");
    expect(await Effect.runPromise(state.resource.load("b"))).toBe(10);
    await Effect.runPromise(Deferred.succeed(result, 3));
    expect(await Effect.runPromise(Fiber.join(mutation))).toBeNull();
    expect(state.value).toBe(10);
    state.activate("a");
    expect(await Effect.runPromise(state.resource.load("a"))).toBe(3);
  });

  it("discards a read after its session is left", async () => {
    const state = heldRead();
    const read = Effect.runFork(state.resource.load("a"));
    await Effect.runPromise(Deferred.await(state.started));
    state.state.activate("b");
    await Effect.runPromise(Deferred.succeed(state.result, 1));
    expect(await Effect.runPromise(Fiber.join(read))).toBeNull();
    expect(state.state.value).toBe(0);
  });

  it("cleans up an interrupted mutation and permits another read", async () => {
    const started = gate<void>();
    const state = fixture(() => Effect.succeed(1));
    const mutation = Effect.runFork(state.resource.update("a", 2,
      Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never))));
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Fiber.interrupt(mutation));
    expect(state.value).toBe(0);
    expect(await Effect.runPromise(state.resource.load("a"))).toBe(1);
  });

  it("shares read failures and permits retry", async () => {
    const result = gate<number, string>();
    const started = gate<void>();
    let calls = 0;
    const state = fixture(() => Effect.suspend(() => {
      calls += 1;
      return calls === 1
        ? Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(result)))
        : Effect.succeed(9);
    }));
    const first = Effect.runFork(state.resource.load("a"));
    await Effect.runPromise(Deferred.await(started));
    const second = Effect.runFork(state.resource.load("a"));
    await Effect.runPromise(Effect.yieldNow());
    await Effect.runPromise(Deferred.fail(result, "failed"));
    expect(Exit.isFailure(await Effect.runPromise(Fiber.await(first)))).toBe(true);
    expect(Exit.isFailure(await Effect.runPromise(Fiber.await(second)))).toBe(true);
    expect(calls).toBe(1);
    expect(await Effect.runPromise(state.resource.load("a"))).toBe(9);
  });
});
