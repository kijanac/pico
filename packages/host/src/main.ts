import { startPicoHost } from "./host.ts";

const host = startPicoHost();

const shutdown = async () => {
  await host.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
