import { describe, expect, it } from "vitest";
import { resolveRoute, routePaths } from "./routes";

describe("routes", () => {
  it("builds typed route paths", () => {
    expect(routePaths.sessions).toBe("/");
    expect(routePaths.settings).toBe("/settings");
    expect(routePaths.session("host/a", "session b")).toBe("/h/host%2Fa/s/session%20b");
  });

  it("matches static routes", () => {
    expect(resolveRoute("/")).toEqual({ id: "sessions", params: {} });
    expect(resolveRoute("/settings")).toEqual({ id: "settings", params: {} });
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
});
