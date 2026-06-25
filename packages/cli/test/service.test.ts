import { Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";
import { resolveServiceOptions } from "../src/commands/service.ts";

const ok = <A>(eff: Effect.Effect<A, Error>) => Effect.runSync(eff);
const fails = (eff: Effect.Effect<unknown, Error>) => Exit.isFailure(Effect.runSyncExit(eff));

describe("resolveServiceOptions flag combos", () => {
  it("defaults to user mode with the orthogonal flags off", () => {
    const o = ok(resolveServiceOptions({ system: false, user: Option.none(), createUser: false }));
    expect(o).toMatchObject({ mode: "user", tailscaleServe: false, autoUpdate: false });
  });

  it("accepts --system with --tailscale-serve and --auto-update", () => {
    const o = ok(resolveServiceOptions({ system: true, user: Option.none(), createUser: false, tailscaleServe: true, autoUpdate: true }));
    expect(o).toMatchObject({ mode: "system", tailscaleServe: true, autoUpdate: true });
  });

  it("allows --tailscale-serve in user mode (serve no longer auto-configures)", () => {
    const o = ok(resolveServiceOptions({ system: false, user: Option.none(), createUser: false, tailscaleServe: true }));
    expect(o).toMatchObject({ mode: "user", tailscaleServe: true });
  });

  it("rejects --user / --create-user without --system", () => {
    expect(fails(resolveServiceOptions({ system: false, user: Option.some("svc"), createUser: false }))).toBe(true);
    expect(fails(resolveServiceOptions({ system: false, user: Option.none(), createUser: true }))).toBe(true);
  });

  it("rejects --auto-update without --system", () => {
    expect(fails(resolveServiceOptions({ system: false, user: Option.none(), createUser: false, autoUpdate: true }))).toBe(true);
  });
});
