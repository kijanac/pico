import { settingsState } from "@/features/settings/settings.state.svelte";
import { ApiClient } from "@/shared/lib/api-client";

// The raw HTTP/WebSocket client (healthcheck, session export, ws stream).
// RPC calls go through rpc-client.ts instead.
export function getHostClient(): ApiClient {
  return createHostClient(settingsState.hostUrl);
}

export function createHostClient(baseUrl: string): ApiClient {
  return new ApiClient(baseUrl);
}
