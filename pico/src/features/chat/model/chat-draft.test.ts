import { describe, expect, it, vi } from "vitest";
import { createChatDraftStore } from "./chat-draft";

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: (key: string) => { values.delete(key); },
  };
  return { values, storage, drafts: createChatDraftStore(() => storage) };
}

const image = () => ({ type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" });

describe("chat drafts", () => {
  it("loads an empty draft without claiming failure", () => {
    const { drafts } = fixture();
    expect(drafts.load("a")).toEqual({ text: "", images: [], saved: true });
  });

  it("preserves text and images across navigation and a new store", () => {
    const { drafts, storage } = fixture();
    const draft = { text: "unsent draft", images: [image()] };
    expect(drafts.save("a", draft)).toBe(true);
    expect(drafts.load("a")).toEqual({ ...draft, saved: true });
    expect(createChatDraftStore(() => storage).load("a")).toEqual({ ...draft, saved: true });
    expect(drafts.load("b").images).toEqual([]);
  });

  it("preserves image-only drafts", () => {
    const { drafts } = fixture();
    expect(drafts.save("a", { text: "", images: [image()] })).toBe(true);
    expect(drafts.load("a").images).toEqual([image()]);
  });

  it("copies image data at the boundary", () => {
    const { drafts } = fixture();
    const attachment = image();
    drafts.save("a", { text: "draft", images: [attachment] });
    attachment.data = "changed";
    const loaded = drafts.load("a");
    Reflect.set(loaded.images[0], "data", "changed again");
    expect(drafts.load("a").images[0].data).toBe("aW1hZ2U=");
  });

  it("keeps the whole draft in memory on storage failure, without claiming persistence", () => {
    const { drafts, storage } = fixture();
    storage.setItem.mockImplementation(() => { throw new Error("quota exceeded"); });
    const draft = { text: "unsent draft", images: [image()] };
    expect(drafts.save("a", draft)).toBe(false);
    expect(drafts.load("a")).toEqual({ ...draft, saved: false });
    const attachment = drafts.load("a").images[0];
    Reflect.set(attachment, "data", "mutated");
    expect(drafts.load("a").images[0].data).toBe("aW1hZ2U=");
  });

  it("can persist a recovered draft after storage becomes available", () => {
    const { drafts, storage, values } = fixture();
    storage.setItem.mockImplementationOnce(() => { throw new Error("quota exceeded"); });
    const draft = { text: "unsent draft", images: [image()] };
    drafts.save("a", draft);
    expect(drafts.save("a", drafts.load("a"))).toBe(true);
    expect(values.has("chat:draft:v2:a")).toBe(true);
    expect(drafts.load("a").saved).toBe(true);
  });

  it("migrates existing text drafts without changing their contents", () => {
    const { drafts, values } = fixture();
    values.set("chat:draft:a", "existing text\n");
    expect(drafts.load("a")).toEqual({ text: "existing text\n", images: [], saved: true });
    drafts.save("a", drafts.load("a"));
    expect(values.has("chat:draft:a")).toBe(false);
    expect(drafts.load("a").text).toBe("existing text\n");
  });

  it("clears text, images and legacy state together", () => {
    const { drafts, values } = fixture();
    drafts.save("a", { text: "draft", images: [image()] });
    values.set("chat:draft:a", "legacy text");
    expect(drafts.clear("a")).toBe(true);
    expect(values.size).toBe(0);
    expect(drafts.load("a")).toEqual({ text: "", images: [], saved: true });
  });

  it("reports corrupt stored drafts instead of accepting invalid attachments", () => {
    const { drafts, values } = fixture();
    values.set("chat:draft:v2:a", JSON.stringify({ text: "draft", images: [{}] }));
    expect(drafts.load("a").saved).toBe(false);
    expect(drafts.load("a").images).toEqual([]);
  });

  it("tolerates unavailable local storage", () => {
    const drafts = createChatDraftStore(() => { throw new Error("storage unavailable"); });
    expect(drafts.load("a").saved).toBe(false);
    drafts.save("a", { text: "draft", images: [image()] });
    expect(drafts.load("a").images).toEqual([image()]);
    drafts.clear("a");
    expect(drafts.load("a")).toEqual({ text: "", images: [], saved: false });
  });
});
