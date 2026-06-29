import { describe, expect, it } from "vitest";
import { resolveRoute, pathFromAppUrl, routePaths } from "./routes";

describe("routes", () => {
  it("builds typed route paths", () => {
    expect(routePaths.sessions).toBe("/");
    expect(routePaths.settings).toBe("/settings");
    expect(routePaths.session("host/a", "session b")).toBe("/h/host%2Fa/s/session%20b");
  });

  it("matches static routes", () => {
    expect(resolveRoute("/")).toEqual({ id: "sessions", params: {} });
    expect(resolveRoute("/settings")).toEqual({ id: "settings", params: {} });
    expect(resolveRoute("/connect?url=https%3A%2F%2Fexample.ts.net")).toEqual({ id: "connect", params: {} });
  });

  it("matches host-qualified sessions", () => {
    expect(resolveRoute("/h/main-host/s/019f")).toEqual({
      id: "session",
      params: { hostId: "main-host", id: "019f" },
    });
    expect(resolveRoute("/h/host%2Fa/s/session%20b")).toEqual({
      id: "session",
      params: { hostId: "host/a", id: "session b" },
    });
  });

  it("does not treat bare session IDs as routable", () => {
    expect(resolveRoute("/s/019f")).toEqual({ id: "not-found", params: { path: "/s/019f" } });
  });

  it("returns not-found for malformed or unknown paths", () => {
    expect(resolveRoute("/h/main-host/s/%E0%A4%A")).toEqual({
      id: "not-found",
      params: { path: "/h/main-host/s/%E0%A4%A" },
    });
    expect(resolveRoute("/missing")).toEqual({ id: "not-found", params: { path: "/missing" } });
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
