import * as crypto from "node:crypto";

type CryptoWithUuidV7 = typeof crypto & {
  randomUUIDv7?: () => string;
};

export function uuidv7(): string {
  const randomUUIDv7 = (crypto as CryptoWithUuidV7).randomUUIDv7;
  if (!randomUUIDv7) {
    throw new Error("Node 26.1+ is required: node:crypto.randomUUIDv7() is unavailable");
  }
  return randomUUIDv7();
}
