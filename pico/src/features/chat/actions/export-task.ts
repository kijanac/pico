import { Cause, Deferred, Effect } from "effect";

export type ExportSubject = { sessionId: string; title: string };
export type ExportTask<A> = ExportSubject & (
  | { status: "preparing" }
  | { status: "ready"; file: A }
  | { status: "failed"; error: string }
);

export function createExportTask<A, E>(options: {
  prepare: (sessionId: string) => Effect.Effect<A, E>;
  commit: (task: ExportTask<A> | null) => void;
  describe: (error: unknown) => string;
}) {
  let task: ExportTask<A> | null = null;
  let pending: Deferred.Deferred<void> | null = null;

  function commit(next: ExportTask<A> | null): void {
    task = next;
    options.commit(next);
  }

  function start(subject: ExportSubject): Effect.Effect<void> {
    return Effect.gen(function*() {
      const settled = yield* Deferred.make<void>();
      if (pending) return yield* Deferred.await(pending);
      pending = settled;
      return yield* Effect.suspend(() => {
        commit({ ...subject, status: "preparing" });
        return options.prepare(subject.sessionId);
      }).pipe(
        Effect.tap((file) => Effect.sync(() => commit({ ...subject, status: "ready", file }))),
        Effect.asVoid,
        Effect.catchAllCause((cause) => Effect.sync(() => {
          commit({ ...subject, status: "failed", error: options.describe(Cause.squash(cause)) });
        })),
        Effect.ensuring(Effect.sync(() => { pending = null; }).pipe(Effect.zipRight(Deferred.succeed(settled, undefined)))),
      );
    });
  }

  function dismiss(): void {
    if (!pending) commit(null);
  }

  return { start, dismiss, get task() { return task; } };
}
