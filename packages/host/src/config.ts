import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { dirname, resolve } from "node:path";

const required = (name: string) =>
  Config.string(name).pipe(
    Config.validate({
      message: `${name} is required`,
      validation: (value) => value.length > 0,
    }),
  );

const flag = (name: string) =>
  Config.string(name).pipe(
    Config.map((value) => value === "1"),
    Config.withDefault(false),
  );

// runSync at load is safe: env comes from the systemd unit or the dev scripts.
const resolved = Effect.runSync(
  Config.all({
    dbPath: required("PICO_HOST_DB"),
    workspacesDir: required("PICO_WORKSPACES_DIR"),
    isProduction: Config.string("NODE_ENV").pipe(
      Config.map((value) => value === "production"),
      Config.withDefault(false),
    ),
    insecureNoAuth: flag("PICO_HOST_INSECURE_NO_AUTH"),
    owner: Config.string("PICO_OWNER").pipe(
      Config.map((login) => login.trim().toLowerCase()),
      Config.withDefault(""),
    ),
    useMock: flag("PI_USE_MOCK"),
    allowUnsafeTestClient: flag("PI_ALLOW_UNSAFE_TEST_CLIENT"),
    ephemeral: flag("PI_EPHEMERAL"),
  }).pipe(
    Config.validate({
      message: "PICO_OWNER is required: the Tailscale login allowed to use this host",
      validation: (config) => config.insecureNoAuth || config.owner !== "",
    }),
  ),
);

export const DB_PATH = resolved.dbPath;
export const HOST_DATA_DIR = dirname(resolve(DB_PATH));
export const WORKSPACES_DIR = resolved.workspacesDir;
export const IS_PRODUCTION = resolved.isProduction;
export const HOST_INSECURE_NO_AUTH = resolved.insecureNoAuth;
export const OWNER_LOGIN = resolved.owner;
export const USE_MOCK = resolved.useMock;
export const ALLOW_UNSAFE_TEST_CLIENT = resolved.allowUnsafeTestClient;
export const PI_EPHEMERAL = resolved.ephemeral;
