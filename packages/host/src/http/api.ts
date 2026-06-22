import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

// Must mirror @pico/host's LocalAdminStatus/LocalAdminPairing.
const HostSystemInfo = Schema.Struct({
  hostVersion: Schema.String,
  protocolVersion: Schema.Number,
  minMobileVersion: Schema.String,
  recommendedMobileVersion: Schema.String,
  updateChannel: Schema.String,
  autoUpdate: Schema.Boolean,
});

export const LocalAdminStatus = Schema.Struct({
  ok: Schema.Literal(true),
  pid: Schema.Number,
  uptimeSeconds: Schema.Number,
  cwd: Schema.String,
  dataDir: Schema.String,
  dbPath: Schema.String,
  workspacesDir: Schema.String,
  claimed: Schema.Boolean,
  owners: Schema.Array(Schema.String),
  pairingTokenConfigured: Schema.Boolean,
  system: Schema.optional(HostSystemInfo),
});

export const LocalAdminPairing = Schema.Struct({
  ...LocalAdminStatus.fields,
  token: Schema.optional(Schema.String),
  tokenConfigured: Schema.Boolean,
});

const SystemGroup = HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("healthz", "/healthz").addSuccess(HttpApiSchema.Text()),
);

const AdminGroup = HttpApiGroup.make("admin")
  .add(HttpApiEndpoint.get("status", "/admin/status").addSuccess(LocalAdminStatus))
  .add(HttpApiEndpoint.get("pairing", "/admin/pairing").addSuccess(LocalAdminPairing))
  .add(HttpApiEndpoint.post("pairingRotate", "/admin/pairing/rotate").addSuccess(LocalAdminPairing));

export const PicoHostApi = HttpApi.make("PicoHost").add(SystemGroup).add(AdminGroup);

export type LocalAdminStatusData = typeof LocalAdminStatus.Type;
export type LocalAdminPairingData = typeof LocalAdminPairing.Type;
