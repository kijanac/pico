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
  piVersion: Schema.optional(Schema.String),
  supportedTerminalPiRange: Schema.optional(Schema.String),
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

export const LocalAdminSessionReleaseRequest = Schema.Struct({
  id: Schema.NonEmptyTrimmedString,
});
export type LocalAdminSessionReleaseRequestData = typeof LocalAdminSessionReleaseRequest.Type;

export const LocalAdminSessionRelease = Schema.Union(
  Schema.Struct({
    ok: Schema.Literal(true),
    id: Schema.String,
    leaseId: Schema.String,
    runtimeSessionId: Schema.String,
    runtimeSessionFile: Schema.String,
    cwd: Schema.String,
    title: Schema.String,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.String,
  }),
);
export type LocalAdminSessionReleaseData = typeof LocalAdminSessionRelease.Type;
