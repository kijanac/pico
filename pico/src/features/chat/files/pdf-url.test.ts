import { describe, expect, it } from "vitest";
import { pdfFileUrl } from "./pdf-url";

describe("PDF file URLs", () => {
  it("keeps paths with spaces, fragments, and query characters intact", () => {
    const path = "/tmp/report é #1 & notes?.pdf";
    const preview = new URL(pdfFileUrl(path), "https://pico.test");
    expect(preview.pathname).toBe("/fs/pdf");
    expect(preview.searchParams.get("path")).toBe(path);
    expect(preview.searchParams.has("download")).toBe(false);
    expect(new URL(pdfFileUrl(path, true), preview).searchParams.get("download")).toBe("1");
  });
});
