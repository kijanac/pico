export async function waitForStopSignal(): Promise<void> {
  await new Promise<void>((resolveStopped) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolveStopped();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
