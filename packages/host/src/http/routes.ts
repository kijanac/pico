import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { SessionManager } from "../session.ts";
import { exportRoute } from "./session-actions.ts";

// Only the streaming HTML export remains here; tRPC moved to /rpc, served by RpcServer.
export const RawRoutesLive = HttpApiBuilder.Router.use((router) =>
  Effect.gen(function* () {
    const manager = yield* SessionManager;
    yield* router.get("/sessions/:id/export.html", exportRoute(manager));
  }),
);
