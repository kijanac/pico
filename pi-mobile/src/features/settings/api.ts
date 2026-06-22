import { createHostClient } from "@/shared/lib/host-client";

export function healthcheckHostUrl(url: string): Promise<boolean> {
  return createHostClient(url.trim()).healthcheck();
}
