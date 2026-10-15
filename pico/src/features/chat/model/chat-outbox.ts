import { ImageContent, SendMode } from "@pico/protocol";
import { Option, Schema } from "effect";

const OutboxRecord = Schema.Struct({
  cid: Schema.String,
  text: Schema.String,
  mode: SendMode,
  images: Schema.optional(Schema.Array(ImageContent)),
  base: Schema.NullOr(Schema.String),
  state: Schema.Literal("sending", "started", "queued", "held", "failed", "lost"),
  error: Schema.optional(Schema.String),
  tries: Schema.NonNegativeInt,
  sentDuringRun: Schema.optional(Schema.Boolean),
});
type StoredOutbox = typeof OutboxRecord.Type;
export type OutboxItem = { -readonly [K in keyof StoredOutbox]: K extends "images" ? ImageContent[] | undefined : StoredOutbox[K] };
const decode = Schema.decodeUnknownOption(Schema.parseJson(Schema.Array(OutboxRecord)));
const copy = (items: readonly StoredOutbox[]): OutboxItem[] => items.map((item) => ({ ...item, images: item.images?.map((image) => ({ ...image })) }));

export function createOutboxStorage(storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  const unsaved = new Map<string, OutboxItem[]>();
  const key = (sessionId: string) => `chat:outbox:${sessionId}`;

  function load(sessionId: string): { items: OutboxItem[]; saved: boolean } {
    const held = unsaved.get(sessionId);
    if (held) return { items: copy(held), saved: false };
    try {
      const items = Option.getOrElse(decode(storage().getItem(key(sessionId)) ?? "[]"), () => []);
      return { items: copy(items), saved: true };
    } catch {
      return { items: [], saved: false };
    }
  }

  function save(sessionId: string, items: readonly OutboxItem[]): boolean {
    try {
      if (items.length === 0) storage().removeItem(key(sessionId));
      else storage().setItem(key(sessionId), JSON.stringify(items));
      unsaved.delete(sessionId);
      return true;
    } catch {
      unsaved.set(sessionId, copy(items));
      try { storage().removeItem(key(sessionId)); } catch {}
      return false;
    }
  }

  return { load, save };
}
