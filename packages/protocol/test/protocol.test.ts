import { Arbitrary, FastCheck, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AssistantMessage,
  AuthLoginJob,
  CompactionEntry,
  ImageContent,
  Entry,
  MessageUsage,
  SendMode,
  ServerMessage,
  SessionMeta,
  SessionStatus,
  ToolCallMessage,
  UserMessage,
} from "../src/index.ts";

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
  ["Entry", Entry],
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

  it("preserves images on user entries", () => {
    const message = {
      t: "entries",
      leaf: "u1",
      entries: [{ type: "user", id: "u1", at: 1, text: "look", images: [{ type: "image", data: "abc", mimeType: "image/png" }] }],
    } as const;
    expect(Schema.decodeUnknownSync(ServerMessage)(message)).toStrictEqual(message);
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

  it("rejects prototype-polluting custom tool args", () => {
    const args = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(args, "__proto__", { value: [], enumerable: true });

    expect(() =>
      Schema.decodeUnknownSync(ToolCallMessage)({
        kind: "tool_call",
        toolKind: "custom",
        id: "tool1",
        at: 1,
        tool: "custom_tool",
        args,
        status: "pending",
      }),
    ).toThrow();
  });
});
