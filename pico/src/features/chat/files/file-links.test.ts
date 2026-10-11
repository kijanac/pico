import { describe, expect, it } from "vitest";
import { isFollowableHref, localFilePath } from "./file-links";

describe("links the agent writes", () => {
  it("open files when they point at a path, with or without line numbers", () => {
    expect(localFilePath("docs/review.md")).toBe("docs/review.md");
    expect(localFilePath("/home/k/notes%20one.md#L12")).toBe("/home/k/notes one.md");
    expect(localFilePath("file:///home/k/a.md")).toBe("/home/k/a.md");
    expect(localFilePath("~/work/a.md?plain=1")).toBe("~/work/a.md");
    expect(localFilePath("main.rs:42")).toBe("main.rs");
    expect(localFilePath("src/main.rs:42:7")).toBe("src/main.rs");
    expect(localFilePath("a%E0.md")).toBe("a%E0.md");
  });

  it("leave web links, mail links and in-page anchors alone", () => {
    for (const href of ["https://example.com/a.md", "mailto:a@b.c", "#section", "//cdn.example.com/x"]) {
      expect(localFilePath(href)).toBeUndefined();
    }
  });

  it("only keep a target the browser can safely follow", () => {
    for (const href of ["https://example.com", "docs/a.md", "#top", "mailto:a@b.c", "file:///a.md"]) expect(isFollowableHref(href)).toBe(true);
    for (const href of ["javascript:alert(1)", "java\tscript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>", "vbscript:x"]) {
      expect(isFollowableHref(href)).toBe(false);
    }
  });
});
