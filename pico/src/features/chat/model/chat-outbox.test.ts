import { describe, expect, it } from "vitest";
import { createOutboxStorage, type OutboxItem } from "./chat-outbox";

function setup() {
  const values = new Map<string, string>();
  let fail = false;
  const writes: string[] = [];
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(value); if (fail) throw new Error("quota"); values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  return { values, writes, outbox: createOutboxStorage(() => storage), storage, fail: () => { fail = true; }, recover: () => { fail = false; } };
}
const item: OutboxItem = { cid: "send-1", text: "look at this", mode: "steer", base: null, state: "failed", tries: 1, images: [{ type: "image", mimeType: "image/png", data: "original attachment" }] };

describe("whole-message outbox persistence", () => {
  it("round trips text and original attachments together", () => {
    const test = setup();
    expect(test.outbox.save("a", [item])).toBe(true);
    expect(test.outbox.load("a")).toEqual({ items: [item], saved: true });
  });

  it("never retries a quota failure with images stripped", () => {
    const test = setup(); test.fail();
    expect(test.outbox.save("a", [item])).toBe(false);
    expect(test.writes).toHaveLength(1);
    expect(JSON.parse(test.writes[0])[0].images).toEqual(item.images);
    expect(test.outbox.load("a")).toEqual({ items: [item], saved: false });
  });

  it("preserves unsaved messages when revisiting after log-cache eviction", () => {
    const test = setup(); test.fail();
    test.outbox.save("a", [item]);
    for (const key of ["b", "c", "d", "e"]) test.outbox.save(key, [{ ...item, cid: key }]);
    expect(test.outbox.load("a").items[0].images).toEqual(item.images);
  });

  it("owns copies of fallback arrays instead of mutable log objects", () => {
    const test = setup(); test.fail();
    const original = { ...item, images: item.images?.map((image) => ({ ...image })) };
    test.outbox.save("a", [original]); original.images!.pop();
    const restored = test.outbox.load("a"); restored.items[0].images!.pop();
    expect(test.outbox.load("a").items[0].images).toEqual(item.images);
  });

  it("removes an older persisted snapshot if a newer write fails", () => {
    const test = setup(); test.outbox.save("a", [item]); test.fail();
    test.outbox.save("a", [{ ...item, text: "newer intent" }]);
    expect(test.values.has("chat:outbox:a")).toBe(false);
    expect(test.outbox.load("a").items[0].text).toBe("newer intent");
  });

  it("recovers full durability without retaining an obsolete fallback", () => {
    const test = setup(); test.fail(); test.outbox.save("a", [item]); test.recover();
    expect(test.outbox.save("a", [item])).toBe(true);
    expect(test.outbox.load("a").saved).toBe(true);
    expect(test.outbox.save("a", [])).toBe(true);
    expect(test.outbox.load("a")).toEqual({ items: [], saved: true });
  });

  it("parses untrusted storage rather than accepting malformed outbox shapes", () => {
    const test = setup();
    for (const value of ["invalid", "null", "{}", '[{"cid":"x"}]', JSON.stringify([{ ...item, tries: -1 }])]) {
      test.values.set("chat:outbox:a", value);
      expect(test.outbox.load("a").items).toEqual([]);
    }
  });

  it("handles unavailable storage without claiming it saved a message", () => {
    const outbox = createOutboxStorage(() => { throw new Error("unavailable"); });
    expect(outbox.save("a", [item])).toBe(false);
    expect(outbox.load("a")).toEqual({ items: [item], saved: false });
    expect(outbox.save("a", [])).toBe(false);
    expect(outbox.load("a").items).toEqual([]);
  });
});
