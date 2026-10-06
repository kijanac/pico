import { Schema } from "effect";

// The loopback admin control plane (admin-token auth over localhost), shared by
// the host server and the local CLI. Distinct from the Tailscale RPC wire
// contract in ./rpc.ts.

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
export type LocalAdminStatusData = typeof LocalAdminStatus.Type;

export const LocalAdminPairing = Schema.Struct({
  ...LocalAdminStatus.fields,
  token: Schema.optional(Schema.String),
  tokenConfigured: Schema.Boolean,
});
export type LocalAdminPairingData = typeof LocalAdminPairing.Type;
