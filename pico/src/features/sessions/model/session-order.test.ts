import { describe, expect, it } from "vitest";
import type { SessionMeta } from "@pico/protocol";
import { createSessionOrder, sortSessions } from "./session-order";

const session = (id: string, updatedAt = "2026-10-15T00:00:00.000Z"): SessionMeta => ({
  id, title: id, cwd: "/workspace", status: "idle", updatedAt, tokens: { in: 0, out: 0 }, costUsd: 0, archived: false,
});

describe("session ordering", () => {
  it("sorts recent sessions first without changing the input", () => {
    const older = session("older");
    const newer = session("newer", "2026-10-15T01:00:00.000Z");
    const input = [older, newer];
    expect(sortSessions(input)).toEqual([newer, older]);
    expect(input).toEqual([older, newer]);
  });

  it("keeps timestamp ties stable regardless of response order", () => {
    const input = [session("a"), session("c"), session("b")];
    expect(sortSessions(input).map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(sortSessions([...input].reverse())).toEqual(sortSessions(input));
  });

  it("reuses order identity for refreshed objects and changed metadata", () => {
    const order = createSessionOrder();
    const first = order([session("a"), session("b")]);
    expect(order([{ ...session("a"), title: "renamed", costUsd: 1, status: "thinking" }, session("b")])).toBe(first);
    expect(order([session("a"), session("b")])).toBe(first);
  });

  it("changes order identity only when membership or position changes", () => {
    const order = createSessionOrder();
    const first = order([session("a"), session("b")]);
    const moved = order([session("b"), session("a")]);
    expect(moved).not.toBe(first);
    expect(moved).toEqual(["b", "a"]);
    const removed = order([session("b")]);
    expect(removed).not.toBe(moved);
    const added = order([session("b"), session("c")]);
    expect(added).not.toBe(removed);
    expect(order([])).toEqual([]);
    expect(order([])).toBe(order([]));
  });
});
