import { Deferred, Effect, Exit } from "effect";

export function createAsyncResource<A, E, R>(options: {
  fetch: (key: string) => Effect.Effect<A, E, R>;
  get: () => A | null;
  commit: (key: string, value: A) => void;
  isActive: (key: string) => boolean;
}) {
  let revision = 0;
  let mutation: { key: string; revision: number; settled: Deferred.Deferred<void> } | null = null;
  let read: { key: string; revision: number; result: Deferred.Deferred<A | null, E> } | null = null;

  function set(key: string, value: A): void {
    if (!options.isActive(key)) return;
    revision += 1;
    options.commit(key, value);
  }

  function load(key: string): Effect.Effect<A | null, E, R> {
    return Effect.gen(function* () {
      const result = yield* Deferred.make<A | null, E>();
      if (mutation?.key === key) {
        return yield* Deferred.await(mutation.settled).pipe(Effect.flatMap(() =>
          options.isActive(key) ? load(key) : Effect.succeed(null),
        ));
      }
      if (read?.key === key && read.revision === revision) return yield* Deferred.await(read.result);
      const request = { key, revision: ++revision, result };
      read = request;
      return yield* Effect.suspend(() => options.fetch(key)).pipe(
        Effect.map((next) => {
          if (request.revision !== revision || !options.isActive(key)) return null;
          options.commit(key, next);
          return next;
        }),
        Effect.onExit((exit) => Deferred.done(result, exit).pipe(Effect.zipRight(Effect.sync(() => {
          if (read === request) read = null;
        })))),
      );
    });
  }

  function update(key: string, optimistic: A, change: Effect.Effect<A, E, R>): Effect.Effect<A | null, E, R> {
    return Effect.gen(function* () {
      const settled = yield* Deferred.make<void>();
      if (!options.isActive(key)) return null;
      const previous = options.get();
      const request = { key, revision: ++revision, settled };
      mutation = request;
      return yield* Effect.suspend(() => {
        options.commit(key, optimistic);
        return change;
      }).pipe(
        Effect.map((next) => {
          if (request.revision !== revision || !options.isActive(key)) return null;
          options.commit(key, next);
          return next;
        }),
        Effect.onExit((exit) => Effect.sync(() => {
          if (mutation === request) mutation = null;
          if (Exit.isFailure(exit) && request.revision === revision && options.isActive(key) && previous !== null) {
            options.commit(key, previous);
          }
        }).pipe(Effect.ensuring(Deferred.succeed(settled, undefined)))),
      );
    });
  }

  return { set, load, update };
}
