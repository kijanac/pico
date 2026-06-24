import { describe, expect, it } from "vitest";
import { applyState, checkManifest, compareVersions, resolveRelease, type GithubRelease } from "../deploy/host-update.mts";

const release = (tag: string, assets = ["pico-host-release.json", "pico-host-release.json.sig"]): GithubRelease => ({
  tag_name: tag,
  assets: assets.map((name) => ({ name, browser_download_url: `https://example/${name}` })),
});

describe("compareVersions", () => {
  it("compares numerically and strips a leading v", () => {
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("v1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.3.0", "1.2.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0); // numeric, not lexical
  });

  it("ranks a prerelease below its release but above the prior version", () => {
    expect(compareVersions("1.3.0-rc.1", "1.3.0")).toBeLessThan(0);
    expect(compareVersions("1.3.0", "1.3.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0-rc.1", "1.2.0")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0-rc.2", "1.3.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0-rc.1", "1.3.0-rc.1")).toBe(0);
  });
});

describe("resolveRelease", () => {
  it("reports no_update when the release is not newer than current", () => {
    expect(resolveRelease(release("v1.2.0"), "1.2.0", "1.2.0")).toEqual({ status: "no_update", version: "1.2.0" });
  });

  it("resolves manifest + sig URLs for a newer release", () => {
    const r = resolveRelease(release("v1.3.0"), "1.2.0", "1.2.0");
    expect(r.status).toBe("update");
    if (r.status === "update") {
      expect(r.version).toBe("1.3.0");
      expect(r.manifestUrl).toContain("pico-host-release.json");
      expect(r.sigUrl).toContain("pico-host-release.json.sig");
    }
  });

  it("refuses to roll back below the last seen version", () => {
    expect(() => resolveRelease(release("v1.1.0"), "1.0.0", "1.5.0")).toThrow(/refusing rollback/);
  });

  it("throws when a required asset is missing", () => {
    expect(() => resolveRelease(release("v1.3.0", ["pico-host-release.json"]), "1.2.0", "1.2.0")).toThrow(/asset missing/);
  });
});

describe("applyState", () => {
  it("records the seen transition", () => {
    expect(applyState({}, "1.3.0", "seen", 100)).toMatchObject({ lastSeenVersion: "1.3.0", lastSeenAt: 100 });
  });

  it("records the failed transition with a reason", () => {
    expect(applyState({}, "1.3.0", "failed", 200, "health_check_failed").failure).toEqual({
      version: "1.3.0",
      reason: "health_check_failed",
      at: 200,
    });
  });

  it("clears prior failure on a successful update", () => {
    const updated = applyState({ failedAt: 1, failure: { version: "x", reason: "y", at: 1 } }, "1.3.0", "updated", 300);
    expect(updated).toMatchObject({ currentVersion: "1.3.0", lastSeenVersion: "1.3.0", updatedAt: 300 });
    expect(updated.failure).toBeUndefined();
    expect(updated.failedAt).toBeUndefined();
  });
});

describe("checkManifest", () => {
  it("rejects a manifest whose version disagrees with the release", () => {
    expect(() => checkManifest({ version: "1.2.0", artifact: { name: "a", sha256: "b" } }, "1.3.0")).toThrow(/does not match/);
  });
});
