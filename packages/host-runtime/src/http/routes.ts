import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { SessionManager } from "../session.ts";
import { exportRoute } from "./session-actions.ts";

// Non-API routes mounted on the same HttpApiBuilder.Router that serve() builds.
// The streaming HTML export is the only one left (tRPC became /rpc, served by
// RpcServer). SessionManager is captured at build time and closed over.
export const RawRoutesLive = HttpApiBuilder.Router.use((router) =>
  Effect.gen(function* () {
    const manager = yield* SessionManager;
    yield* router.get("/sessions/:id/export.html", exportRoute(manager));
  }),
);
