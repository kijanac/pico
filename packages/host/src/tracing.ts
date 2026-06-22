import { NodeSdk } from "@effect/opentelemetry";
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { PRODUCT_VERSION } from "@pico/protocol";
import { Layer } from "effect";
import { OTEL_CONSOLE } from "./config.ts";

// @effect/platform and @effect/rpc emit spans automatically once a tracer is in
// context, so installing this layer is sufficient. When off, Effect's no-op
// tracer makes every span zero-cost.
export const TracingLive = OTEL_CONSOLE
  ? NodeSdk.layer(() => ({
      resource: { serviceName: "pico-host", serviceVersion: PRODUCT_VERSION },
      spanProcessor: new SimpleSpanProcessor(new ConsoleSpanExporter()),
    }))
  : Layer.empty;
