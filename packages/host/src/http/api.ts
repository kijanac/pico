import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";

const SystemGroup = HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("healthz", "/healthz").addSuccess(HttpApiSchema.Text()),
);

export const PicoHostApi = HttpApi.make("PicoHost").add(SystemGroup);
