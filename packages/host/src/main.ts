import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { hostLayer } from "./host.ts";

// runMain interrupts on SIGINT/SIGTERM (running every finalizer) and exits
// non-zero if the host fails, so systemd sees real failures. The default
// logger keeps one key=value line per event, which journald needs.
NodeRuntime.runMain(Layer.launch(hostLayer(7777)), { disablePrettyLogger: true });
