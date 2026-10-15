import { describe, expect, it } from "vitest";
import { imageFileUrl, imagePreviewUrl } from "./image-preview";

describe("image preview sources", () => {
  it("encodes original host paths without exposing filesystem URLs", () => {
    const path = "/tmp/screenshots/a & #é.png";
    const url = new URL(imageFileUrl(path, true), "https://pico.test");
    expect(url.pathname).toBe("/fs/image");
    expect(url.searchParams.get("path")).toBe(path);
    expect(url.searchParams.get("download")).toBe("1");
  });

  it("accepts only supported raster media for inline opening or download", () => {
    for (const mimeType of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]) {
      expect(imagePreviewUrl({ type: "image", mimeType, data: "original bytes" })).toBe(`data:${mimeType};base64,original bytes`);
    }
    for (const mimeType of ["image/svg+xml", "text/html", "image/png;bad", "application/javascript"]) {
      expect(imagePreviewUrl({ type: "image", mimeType, data: "arbitrary bytes" })).toBeNull();
    }
  });
});
