import { describe, expect, it } from "vitest";
import { resolveRoute, routePaths } from "./routes";

describe("routes", () => {
  it("builds typed route paths", () => {
    expect(routePaths.sessions).toBe("/");
    expect(routePaths.settings).toBe("/settings");
    expect(routePaths.session("session b")).toBe("/s/session%20b");
  });

  it("matches static routes", () => {
    expect(resolveRoute("/")).toEqual({ id: "sessions", params: {} });
    expect(resolveRoute("/settings")).toEqual({ id: "settings", params: {} });
  });

  it("matches sessions", () => {
    expect(resolveRoute("/s/019f")).toEqual({ id: "session", params: { id: "019f" } });
    expect(resolveRoute("/s/session%20b")).toEqual({ id: "session", params: { id: "session b" } });
  });

  it("returns not-found for malformed or unknown paths", () => {
    expect(resolveRoute("/s/%E0%A4%A")).toEqual({ id: "not-found", params: { path: "/s/%E0%A4%A" } });
    expect(resolveRoute("/missing")).toEqual({ id: "not-found", params: { path: "/missing" } });
  });
});
