import { Arbitrary, FastCheck, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AssistantMessage,
  AuthLoginJob,
  CompactionEntry,
  ImageContent,
  MessageUsage,
  MIN_MOBILE_VERSION,
  PRODUCT_VERSION,
  PROTOCOL_VERSION,
  QueueState,
  RECOMMENDED_MOBILE_VERSION,
  SendMode,
  SessionMeta,
  SessionStatus,
  ToolCallMessage,
  UserMessage,
  WireEvent,
} from "../src/index.ts";
import { emptyLog, reduceLog } from "../src/log.ts";

// Representative messages spanning literals, structs, and unions.
const WIRE_SCHEMAS: ReadonlyArray<readonly [string, Schema.Schema<any>]> = [
  ["SendMode", SendMode],
  ["SessionStatus", SessionStatus],
  ["MessageUsage", MessageUsage],
  ["UserMessage", UserMessage],
  ["AssistantMessage", AssistantMessage],
  ["AuthLoginJob", AuthLoginJob],
  ["ToolCallMessage", ToolCallMessage],
  ["CompactionEntry", CompactionEntry],
  ["SessionMeta", SessionMeta],
];

describe("wire messages survive an encode/decode round-trip", () => {
  for (const [name, schema] of WIRE_SCHEMAS) {
    it(`${name}: decode(encode(x)) deep-equals x for any valid value`, () => {
      const arb = Arbitrary.make(schema);
      const encode = Schema.encodeSync(schema);
      const decode = Schema.decodeUnknownSync(schema);
      FastCheck.assert(
        FastCheck.property(arb, (value) => {
          expect(decode(encode(value))).toStrictEqual(value);
        }),
        { numRuns: 50 },
      );
    });
  }
});

describe("decoding rejects malformed input", () => {
  it("refuses values that don't match the schema", () => {
    expect(() => Schema.decodeUnknownSync(UserMessage)({ not: "a user message" })).toThrow();
    expect(() => Schema.decodeUnknownSync(SendMode)("sideways")).toThrow();
  });

  it("requires Pi-shaped image content", () => {
    const image = { type: "image", data: "abc", mimeType: "image/png" } as const;
    expect(Schema.decodeUnknownSync(ImageContent)(image)).toStrictEqual(image);
    expect(() => Schema.decodeUnknownSync(ImageContent)({ data: "abc", mimeType: "image/png" })).toThrow();
  });

  it("requires queued user messages to carry a mode", () => {
    expect(() =>
      Schema.decodeUnknownSync(UserMessage)({ kind: "user", id: "u1", at: 1, text: "queued", queued: true }),
    ).toThrow();

    expect(
      Schema.decodeUnknownSync(UserMessage)({ kind: "user", id: "u1", at: 1, text: "queued", queued: true, mode: "follow_up" }),
    ).toMatchObject({ queued: true, mode: "follow_up" });
  });

  it("preserves images on user_message wire events", () => {
    const event = {
      t: "user_message",
      seq: 1,
      entry: { kind: "user", id: "u1", at: 1, text: "look", images: [{ type: "image", data: "abc", mimeType: "image/png" }] },
    } as const;
    expect(Schema.decodeUnknownSync(WireEvent)(event)).toStrictEqual(event);

    const log = emptyLog();
    reduceLog(log, event, 1);
    expect(log.entries[0]).toMatchObject({ kind: "user", text: "look", images: event.entry.images });
  });

  it("preserves provider auth select jobs", () => {
    const job = {
      id: "auth1",
      providerId: "provider",
      providerName: "Provider",
      status: "select",
      selectMessage: "Choose login method",
      selectOptions: [{ id: "device_code", label: "Device code login" }],
    } as const;
    expect(Schema.decodeUnknownSync(AuthLoginJob)(job)).toStrictEqual(job);
  });

  it("preserves images on queue snapshots", () => {
    const queue = {
      queued: [{ id: "q1", text: "later", mode: "steer", images: [{ type: "image", data: "abc", mimeType: "image/png" }] }],
    } as const;
    expect(Schema.decodeUnknownSync(QueueState)(queue)).toStrictEqual(queue);
  });
});

describe("version constants hold their invariants across releases", () => {
  const isSemver = (v: string) => /^\d+\.\d+\.\d+$/.test(v);
  const cmp = (a: string, b: string): number => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  };

  it("PROTOCOL_VERSION is a positive integer", () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it("product and minimum versions are semver, and recommended tracks product", () => {
    expect(isSemver(PRODUCT_VERSION)).toBe(true);
    expect(isSemver(MIN_MOBILE_VERSION)).toBe(true);
    expect(RECOMMENDED_MOBILE_VERSION).toBe(PRODUCT_VERSION);
  });

  it("the minimum supported mobile version never exceeds the current product", () => {
    expect(cmp(MIN_MOBILE_VERSION, PRODUCT_VERSION)).toBeLessThanOrEqual(0);
  });
});
