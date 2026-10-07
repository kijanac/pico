import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vitest";

// store.ts imports config.ts, which reads env at import.
async function withStore<A>(run: (store: import("../src/store.ts").Store["Type"]) => Effect.Effect<A>): Promise<A> {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), "pico-store-"));
  process.env.PICO_HOST_DB = join(dir, "host.db");
  process.env.PICO_WORKSPACES_DIR = dir;
  process.env.PICO_HOST_INSECURE_NO_AUTH = "1";
  const { Store, StoreLive } = await import("../src/store.ts");
  return Effect.runPromise(
    Effect.flatMap(Store, run).pipe(
      Effect.provide(StoreLive(process.env.PICO_HOST_DB)),
      Effect.provide(NodeFileSystem.layer),
    ),
  );
}

const record = {
  id: "s1",
  title: "first",
  cwd: "/work",
  status: "thinking" as const,
  updatedAtMs: 1,
  tokens: { in: 10, out: 20 },
  costUsd: 0.5,
  archived: false,
};

describe("session updates write only the fields they name", () => {
  it("renaming keeps status and usage that changed since the caller read the row", async () => {
    const after = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.insertSession(record);
        yield* store.updateSession("s1", { tokens: { in: 99, out: 98 }, costUsd: 2 });
        yield* store.updateSession("s1", { title: "renamed", updatedAtMs: 5 });
        return yield* store.getSession("s1");
      }),
    );
    expect(Option.getOrThrow(after)).toEqual({
      ...record,
      title: "renamed",
      updatedAtMs: 5,
      tokens: { in: 99, out: 98 },
      costUsd: 2,
    });
  });

  it("updating a missing session creates nothing", async () => {
    const after = await withStore((store) =>
      store.updateSession("gone", { title: "x" }).pipe(Effect.andThen(store.getSession("gone"))),
    );
    expect(Option.isNone(after)).toBe(true);
  });
});
