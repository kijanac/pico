import "node:crypto";

declare module "node:crypto" {
  function randomUUIDv7(options?: RandomUUIDOptions): UUID;
}
