import { Config, Effect } from "effect";
import { dirname, resolve } from "node:path";

// Required env var, rejecting empty values to match the previous `if (!value)` check.
const required = (name: string) =>
  Config.string(name).pipe(
    Config.validate({
      message: `${name} is required`,
      validation: (value) => value.length > 0,
    }),
  );

// `process.env.X === "1"`: absent or any non-"1" value is false, never fails.
const flag = (name: string) =>
  Config.string(name).pipe(
    Config.map((value) => value === "1"),
    Config.withDefault(false),
  );

// Resolved at load; env is already populated by the CLI wrapper and dev scripts.
const resolved = Effect.runSync(
  Config.all({
    dbPath: required("PICO_HOST_DB"),
    workspacesDir: required("PICO_WORKSPACES_DIR"),
    isProduction: Config.string("NODE_ENV").pipe(
      Config.map((value) => value === "production"),
      Config.withDefault(false),
    ),
    insecureNoAuth: flag("PICO_HOST_INSECURE_NO_AUTH"),
    pairingToken: Config.string("PICO_PAIRING_TOKEN").pipe(
      Config.orElse(() => Config.string("PICO_HOST_PAIRING_TOKEN")),
      Config.withDefault(undefined),
    ),
    useMock: flag("PI_USE_MOCK"),
    otelConsole: flag("PICO_HOST_OTEL"),
    allowUnsafeTestClient: flag("PI_ALLOW_UNSAFE_TEST_CLIENT"),
    ephemeral: flag("PI_EPHEMERAL"),
    autoUpdate: flag("PICO_HOST_AUTO_UPDATE"),
    updateRequestPath: Config.string("PICO_HOST_UPDATE_REQUEST_PATH").pipe(
      Config.withDefault("/var/lib/pico-host/update-request"),
    ),
    updateStatePath: Config.string("PICO_HOST_UPDATE_STATE_PATH").pipe(
      Config.withDefault("/var/lib/pico-host/update-state.json"),
    ),
  }),
);

export const DB_PATH = resolved.dbPath;
export const HOST_DATA_DIR = dirname(resolve(DB_PATH));
export const WORKSPACES_DIR = resolved.workspacesDir;
export const IS_PRODUCTION = resolved.isProduction;
export const HOST_INSECURE_NO_AUTH = resolved.insecureNoAuth;
export const INITIAL_PAIRING_TOKEN = resolved.pairingToken;
export const USE_MOCK = resolved.useMock;
export const OTEL_CONSOLE = resolved.otelConsole;
export const ALLOW_UNSAFE_TEST_CLIENT = resolved.allowUnsafeTestClient;
export const PI_EPHEMERAL = resolved.ephemeral;
export const AUTO_UPDATE = resolved.autoUpdate;
export const UPDATE_REQUEST_PATH = resolved.updateRequestPath;
export const UPDATE_STATE_PATH = resolved.updateStatePath;
