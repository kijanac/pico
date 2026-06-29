import { describe, expect, it } from "vitest";
import { matchRoute, pathFromAppUrl, routePaths } from "./routes";

describe("routes", () => {
  it("builds typed route paths", () => {
    expect(routePaths.sessions).toBe("/");
    expect(routePaths.settings).toBe("/settings");
    expect(routePaths.session("host/a", "session b")).toBe("/h/host%2Fa/s/session%20b");
  });

  it("matches static routes", () => {
    expect(matchRoute("/")).toEqual({ id: "sessions", params: {} });
    expect(matchRoute("/settings")).toEqual({ id: "settings", params: {} });
    expect(matchRoute("/connect?url=https%3A%2F%2Fexample.ts.net")).toEqual({ id: "connect", params: {} });
  });

  it("matches host-qualified sessions", () => {
    expect(matchRoute("/h/main-host/s/019f")).toEqual({
      id: "session",
      params: { hostId: "main-host", id: "019f" },
    });
    expect(matchRoute("/h/host%2Fa/s/session%20b")).toEqual({
      id: "session",
      params: { hostId: "host/a", id: "session b" },
    });
  });

  it("matches legacy session routes separately", () => {
    expect(matchRoute("/s/019f")).toEqual({ id: "legacy-session", params: { id: "019f" } });
  });

  it("returns not-found for malformed or unknown paths", () => {
    expect(matchRoute("/h/main-host/s/%E0%A4%A")).toEqual({
      id: "not-found",
      params: { path: "/h/main-host/s/%E0%A4%A" },
    });
    expect(matchRoute("/missing")).toEqual({ id: "not-found", params: { path: "/missing" } });
  });

  it("recognizes app connect URLs", () => {
    expect(pathFromAppUrl("pico://connect?url=https%3A%2F%2Fhost.ts.net&claim=abc")).toBe(
      "/connect?url=https%3A%2F%2Fhost.ts.net&claim=abc",
    );
    expect(pathFromAppUrl("https://example.com/connect?url=https%3A%2F%2Fhost.ts.net")).toBe(
      "/connect?url=https%3A%2F%2Fhost.ts.net",
    );
    expect(pathFromAppUrl("https://example.com/other")).toBeNull();
  });
});
