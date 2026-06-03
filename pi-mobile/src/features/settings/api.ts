import { createBridgeClient } from "@/shared/lib/bridge-client";

export function healthcheckBridgeUrl(url: string): Promise<boolean> {
  return createBridgeClient(url.trim()).healthcheck();
}
