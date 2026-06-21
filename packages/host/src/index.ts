export { getBundledPiSdkVersion, startPicoHost } from "@pico/host-runtime/host";
export type { PicoHostHandle, StartPicoHostOptions } from "@pico/host-runtime/host";
export { getLocalAdminPairing, getLocalAdminStatus, localAdminTokenPath, readLocalAdminToken, rotateLocalAdminPairingToken } from "./admin.ts";
export type { LocalAdminPairing, LocalAdminStatus } from "./admin.ts";
export { collectDoctorChecks } from "./doctor.ts";
export { PicoSetupError, setupErrorMessage } from "./errors.ts";
export type { Diagnostic, DiagnosticCode, DiagnosticLevel } from "./errors.ts";
export { healthcheck, portIsOpen } from "./network.ts";
export { DEFAULT_PICO_HOST_BIND, DEFAULT_PICO_HOST_PORT, defaultPicoHostDataDir, picoHostPathsFromEnv, systemPicoHostPathsFromEnv } from "./paths.ts";
export type { PicoHostPaths } from "./paths.ts";
export {
  getOrCreatePairingToken,
  makePairingDeepLink,
  makePairingToken,
  pairingTokenPath,
  readPairingToken,
  rotatePairingToken,
  writePairingToken,
} from "./pairing.ts";
export { ensureTailscaleServe, inspectTailscale } from "./tailscale.ts";
export type { TailscaleState, TailscaleStatus } from "./tailscale.ts";
export { preparePairing, prepareServing } from "./setup.ts";
export type { PairingPlan, PreparePairingOptions, PrepareServingOptions, ServingPlan } from "./setup.ts";
export {
  defaultServiceCommand,
  installService,
  logsService,
  serviceFilePath,
  startService,
  stopService,
  uninstallService,
  validateServiceCommand,
} from "./service.ts";
export type { ServiceCommand, ServiceControlOptions, ServiceMode, ServiceOptions, ServiceResult } from "./service.ts";
