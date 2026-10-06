import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import {
  LocalAdminPairing,
  LocalAdminSessionRelease,
  LocalAdminSessionReleaseRequest,
  LocalAdminStatus,
} from "@pico/protocol/admin";

const SystemGroup = HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("healthz", "/healthz").addSuccess(HttpApiSchema.Text()),
);

const AdminGroup = HttpApiGroup.make("admin")
  .add(HttpApiEndpoint.get("status", "/admin/status").addSuccess(LocalAdminStatus))
  .add(HttpApiEndpoint.get("pairing", "/admin/pairing").addSuccess(LocalAdminPairing))
  .add(HttpApiEndpoint.post("pairingRotate", "/admin/pairing/rotate").addSuccess(LocalAdminPairing))
  .add(
    HttpApiEndpoint.post("sessionRelease", "/admin/session/release")
      .setPayload(LocalAdminSessionReleaseRequest)
      .addSuccess(LocalAdminSessionRelease),
  );

export const PicoHostApi = HttpApi.make("PicoHost").add(SystemGroup).add(AdminGroup);
