import type { AuthLoginJob, AuthProviders } from "@pi-mobile/protocol";
import { getBridgeClient } from "@/shared/lib/bridge-client";

export function listAuthProviders(): Promise<AuthProviders> {
  return getBridgeClient().listAuthProviders();
}

export function startAuthLogin(providerId: string): Promise<AuthLoginJob> {
  return getBridgeClient().startAuthLogin(providerId);
}

export function getAuthLoginJob(jobId: string): Promise<AuthLoginJob> {
  return getBridgeClient().getAuthLoginJob(jobId);
}

export function submitAuthLoginInput(jobId: string, value: string): Promise<AuthLoginJob> {
  return getBridgeClient().submitAuthLoginInput(jobId, value);
}

export function saveAuthApiKey(providerId: string, apiKey: string): Promise<AuthProviders> {
  return getBridgeClient().saveAuthApiKey(providerId, apiKey);
}

export function cancelAuthLogin(jobId: string): Promise<void> {
  return getBridgeClient().cancelAuthLogin(jobId);
}
