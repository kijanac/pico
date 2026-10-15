import { Deferred, Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { createExportTask, type ExportTask } from "./export-task";

const subject = { sessionId: "a", title: "conversation a" };
const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);

function fixture(prepare: (id: string) => Effect.Effect<string, Error>) {
  const changes: (ExportTask<string> | null)[] = [];
  const task = createExportTask({ prepare, commit: (next) => changes.push(next), describe: describeError });
  return { task, changes };
}

function heldExport() {
  const started = Effect.runSync(Deferred.make<void>());
  const result = Effect.runSync(Deferred.make<string, Error>());
  let calls = 0;
  const state = fixture(() => Effect.suspend(() => {
    calls += 1;
    return Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(result)));
  }));
  return { ...state, started, result, get calls() { return calls; } };
}

describe("export tasks", () => {
  it("reports preparation and then a ready file", async () => {
    const { task, changes } = fixture(() => Effect.succeed("html"));
    await Effect.runPromise(task.start(subject));
    expect(changes).toEqual([{ ...subject, status: "preparing" }, { ...subject, status: "ready", file: "html" }]);
  });

  it("coalesces repeated preparation requests", async () => {
    const state = heldExport();
    const first = Effect.runFork(state.task.start(subject));
    await Effect.runPromise(Deferred.await(state.started));
    const others = Array.from({ length: 10 }, () => Effect.runFork(state.task.start(subject)));
    await Effect.runPromise(Effect.yieldNow());
    expect(state.calls).toBe(1);
    await Effect.runPromise(Deferred.succeed(state.result, "html"));
    await Effect.runPromise(Fiber.join(first));
    await Effect.runPromise(Effect.all(others.map(Fiber.join)));
    expect(state.changes).toHaveLength(2);
  });

  it("retains the initiating session when another request arrives during preparation", async () => {
    const state = heldExport();
    const first = Effect.runFork(state.task.start(subject));
    await Effect.runPromise(Deferred.await(state.started));
    const other = Effect.runFork(state.task.start({ sessionId: "b", title: "conversation b" }));
    await Effect.runPromise(Effect.yieldNow());
    await Effect.runPromise(Deferred.succeed(state.result, "html"));
    await Effect.runPromise(Fiber.join(first));
    await Effect.runPromise(Fiber.join(other));
    expect(state.task.task).toEqual({ ...subject, status: "ready", file: "html" });
    expect(state.calls).toBe(1);
  });

  it("keeps a pending task visible if dismiss is attempted", async () => {
    const state = heldExport();
    const fiber = Effect.runFork(state.task.start(subject));
    await Effect.runPromise(Deferred.await(state.started));
    state.task.dismiss();
    expect(state.task.task?.status).toBe("preparing");
    await Effect.runPromise(Deferred.succeed(state.result, "html"));
    await Effect.runPromise(Fiber.join(fiber));
    state.task.dismiss();
    expect(state.task.task).toBeNull();
  });

  it("reports a failure and allows retry", async () => {
    let calls = 0;
    const { task } = fixture(() => ++calls === 1 ? Effect.fail(new Error("export unavailable")) : Effect.succeed("html"));
    await Effect.runPromise(task.start(subject));
    expect(task.task).toEqual({ ...subject, status: "failed", error: "export unavailable" });
    await Effect.runPromise(task.start(subject));
    expect(task.task).toEqual({ ...subject, status: "ready", file: "html" });
  });

  it("reports defects rather than leaving a preparing task stuck", async () => {
    const { task } = fixture(() => Effect.die(new Error("unexpected export error")));
    await Effect.runPromise(task.start(subject));
    expect(task.task).toEqual({ ...subject, status: "failed", error: "unexpected export error" });
    task.dismiss();
    expect(task.task).toBeNull();
  });

  it("prepares a fresh export when asked again after completion", async () => {
    let calls = 0;
    const { task } = fixture(() => Effect.sync(() => `html-${++calls}`));
    await Effect.runPromise(task.start(subject));
    await Effect.runPromise(task.start(subject));
    expect(task.task).toEqual({ ...subject, status: "ready", file: "html-2" });
  });
});
