import { settingsState } from "@/features/settings/settings.state.svelte";
import { ApiClient } from "@/shared/lib/api-client";

// RPC calls go through rpc-client.ts instead.
export function getHostClient(): ApiClient {
  return createHostClient(settingsState.hostUrl);
}

export function createHostClient(baseUrl: string): ApiClient {
  return new ApiClient(baseUrl);
}
