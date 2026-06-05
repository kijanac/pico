import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@pico/protocol/trpc";

type BridgeTrpcClient = ReturnType<typeof createTRPCClient<AppRouter>>;

const clients = new Map<string, BridgeTrpcClient>();

export function createBridgeTrpcClient(baseUrl: string): BridgeTrpcClient {
  const cached = clients.get(baseUrl);
  if (cached) return cached;

  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${baseUrl}/trpc`,
      }),
    ],
  });
  clients.set(baseUrl, client);
  return client;
}
