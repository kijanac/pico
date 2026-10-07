import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpApiSchema from "@effect/platform/HttpApiSchema";

const SystemGroup = HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("healthz", "/healthz").addSuccess(HttpApiSchema.Text()),
);

export const PicoHostApi = HttpApi.make("PicoHost").add(SystemGroup);
