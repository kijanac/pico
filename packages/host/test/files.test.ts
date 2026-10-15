import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as HttpApp from "@effect/platform/HttpApp";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageRoute, pdfRoute } from "../src/http/files.ts";
import { MAX_IMAGE_BYTES } from "../src/fs.ts";
import { parseByteRange } from "../src/http/byte-range.ts";

const dirs: string[] = [];
const handlers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(handlers.splice(0).map((dispose) => dispose()));
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  vi.unstubAllEnvs();
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pico-pdf-"));
  dirs.push(dir);
  const path = join(dir, "report é.pdf");
  const bytes = Buffer.from("%PDF-1.7\n\x00\xfforiginal bytes", "latin1");
  writeFileSync(path, bytes);
  writeFileSync(join(dir, "text.pdf"), "not a PDF");
  return { dir, path, bytes };
}

const fileLayer = NodeFileSystem.layer;

function handler(app = pdfRoute) {
  const server = HttpApp.toWebHandlerLayer(app, fileLayer);
  handlers.push(server.dispose);
  return server.handler;
}

const request = (path: string, headers: Record<string, string> = {}, extra: Record<string, string> = {}) =>
  new Request(`http://pico.test/fs/pdf?${new URLSearchParams({ path, ...extra })}`, { headers });

describe("PDF delivery", () => {
  it("streams the exact original bytes and supports downloads", async () => {
    const { path, bytes } = fixture();
    const response = await handler()(request(path, {}, { download: "1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("attachment; filename*=UTF-8''report%20%C3%A9.pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("uses the same relative path resolution as the sheet", async () => {
    const { dir, path, bytes } = fixture();
    const response = await handler()(request("report é.pdf", {}, { relativeTo: dir }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("inline;");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(path).toContain(dir);
  });

  it("serves byte ranges without changing the content", async () => {
    const { path, bytes } = fixture();
    const serve = handler();
    for (const [range, start, end] of [["bytes=0-4", 0, 4], ["bytes=9-", 9, bytes.length - 1], ["bytes=-5", bytes.length - 5, bytes.length - 1]] as const) {
      const response = await serve(request(path, { range }));
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end}/${bytes.length}`);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(start, end + 1));
    }
    const invalid = await serve(request(path, { range: "bytes=1000-" }));
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe(`bytes */${bytes.length}`);
  });

  it("rejects missing files, folders, non-PDF content, and cross-site embeds", async () => {
    const { dir, path } = fixture();
    const serve = handler();
    expect((await serve(request(join(dir, "missing")))).status).toBe(404);
    expect((await serve(request(dir))).status).toBe(415);
    expect((await serve(request(join(dir, "text.pdf")))).status).toBe(415);
    expect((await serve(request(path, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });

  it("is protected by the existing owner and origin gate", async () => {
    const { path, dir } = fixture();
    vi.resetModules();
    vi.stubEnv("PICO_HOST_DB", join(dir, "host.db"));
    vi.stubEnv("PICO_OWNER", "owner@example.test");
    vi.stubEnv("PICO_HOST_INSECURE_NO_AUTH", "0");
    const { authMiddleware } = await import("../src/http/middleware.ts");
    const serve = handler(authMiddleware(pdfRoute.pipe(Effect.provide(fileLayer))));
    expect((await serve(request(path, { host: "pico.test" }))).status).toBe(401);
    expect((await serve(request(path, { host: "pico.test", "tailscale-user-login": "other@example.test" }))).status).toBe(403);
    expect((await serve(request(path, { host: "pico.test", "tailscale-user-login": "owner@example.test", origin: "http://evil.test" }))).status).toBe(403);
    const response = await serve(request(path, { host: "pico.test", "tailscale-user-login": "owner@example.test", origin: "http://pico.test" }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });
});

describe("image delivery", () => {
  it("streams original raster bytes with their sniffed type, ranges, and download disposition", async () => {
    const { dir } = fixture();
    const path = join(dir, "screenshot unusual.ext");
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7XkAAAAASUVORK5CYII=", "base64");
    writeFileSync(path, bytes);
    const serve = handler(imageRoute);
    const response = await serve(request(path, {}, { download: "1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    const partial = await serve(request(path, { range: "bytes=0-7" }));
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(0, 8));
  });

  it("rejects active formats, misleading extensions, huge images, and cross-site requests", async () => {
    const { dir } = fixture();
    const serve = handler(imageRoute);
    const path = join(dir, "test.png");
    writeFileSync(path, "<svg onload='alert(1)'></svg>");
    expect((await serve(request(path))).status).toBe(415);
    writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect((await serve(request(path, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await serve(request(path, { "sec-fetch-site": "same-site" }))).status).toBe(403);
    truncateSync(path, MAX_IMAGE_BYTES + 1);
    expect((await serve(request(path))).status).toBe(413);
  });

  it("uses the same owner and origin authorization as PDF delivery", async () => {
    const { dir } = fixture();
    const path = join(dir, "private.png");
    writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    vi.resetModules();
    vi.stubEnv("PICO_HOST_DB", join(dir, "image-host.db"));
    vi.stubEnv("PICO_OWNER", "owner@example.test");
    vi.stubEnv("PICO_HOST_INSECURE_NO_AUTH", "0");
    const { authMiddleware } = await import("../src/http/middleware.ts");
    const serve = handler(authMiddleware(imageRoute.pipe(Effect.provide(fileLayer))));
    expect((await serve(request(path, { host: "pico.test" }))).status).toBe(401);
    expect((await serve(request(path, { host: "pico.test", "tailscale-user-login": "other@example.test" }))).status).toBe(403);
    expect((await serve(request(path, { host: "pico.test", "tailscale-user-login": "owner@example.test", origin: "http://evil.test" }))).status).toBe(403);
    const response = await serve(request(path, { host: "pico.test", "tailscale-user-login": "owner@example.test" }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });
});

describe("PDF byte ranges", () => {
  it("clamps valid ranges and refuses ambiguous or impossible ones", () => {
    expect(parseByteRange(undefined, 20)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=3-100", 20)).toEqual({ kind: "partial", start: 3, end: 19 });
    expect(parseByteRange("bytes=-100", 20)).toEqual({ kind: "partial", start: 0, end: 19 });
    for (const header of ["bytes=-0", "bytes=-", "bytes=5-4", "bytes=20-", "bytes=0-1,3-4", "bytes=999999999999999999999-"]) {
      expect(parseByteRange(header, 20)).toEqual({ kind: "invalid" });
    }
  });
});
