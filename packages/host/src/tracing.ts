import { NodeSdk } from "@effect/opentelemetry";
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { PRODUCT_VERSION } from "@pico/protocol";
import { Layer } from "effect";
import { OTEL_CONSOLE } from "./config.ts";

// Local-development tracing: PICO_HOST_OTEL=1 prints OpenTelemetry spans to the
// console (SimpleSpanProcessor exports each span immediately, in order). The
// @effect/platform HTTP server and @effect/rpc emit spans automatically once a
// tracer is in context, so this lights up per-request / per-RPC spans for free.
//
// Off by default: no SDK is installed, so Effect's no-op tracer makes every
// span a zero-cost no-op in production.
export const TracingLive = OTEL_CONSOLE
  ? NodeSdk.layer(() => ({
      resource: { serviceName: "pico-host", serviceVersion: PRODUCT_VERSION },
      spanProcessor: new SimpleSpanProcessor(new ConsoleSpanExporter()),
    }))
  : Layer.empty;
