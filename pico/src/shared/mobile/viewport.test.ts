import { describe, expect, it } from "vitest";
import { projectViewport, sameViewportFrame, type ViewportFrame } from "./viewport";

const layout = { width: 390, height: 844 };
const visual = (overrides = {}) => ({ width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1, ...overrides });

const fullFrame: ViewportFrame = { width: 390, height: 844, top: 0, left: 0, bottom: 0, coveredHeight: 0 };

describe("viewport frame equality", () => {
  it("commits the first measured frame", () => {
    expect(sameViewportFrame(null, fullFrame)).toBe(false);
  });

  it("suppresses duplicate metrics regardless of object identity", () => {
    expect(sameViewportFrame(fullFrame, { ...fullFrame })).toBe(true);
  });

  it.each(["top", "left", "width", "height", "bottom", "coveredHeight"] as const)("detects a change to %s", (key) => {
    expect(sameViewportFrame(fullFrame, { ...fullFrame, [key]: fullFrame[key] + 1 })).toBe(false);
  });
});

describe("visual viewport projection", () => {
  it("uses the layout viewport when VisualViewport is unavailable", () => {
    expect(projectViewport(layout)).toEqual({ width: 390, height: 844, top: 0, left: 0, bottom: 0, coveredHeight: 0 });
  });

  it("preserves the full frame with the keyboard closed", () => {
    expect(projectViewport(layout, visual())).toEqual({ width: 390, height: 844, top: 0, left: 0, bottom: 0, coveredHeight: 0 });
  });

  it("shrinks the frame rather than adding a second keyboard-sized padding", () => {
    expect(projectViewport(layout, visual({ height: 500 }))).toEqual({ width: 390, height: 500, top: 0, left: 0, bottom: 344, coveredHeight: 344 });
  });

  it("anchors the header and sheet edges after keyboard-induced viewport panning", () => {
    const frame = projectViewport(layout, visual({ height: 500, offsetTop: 80 }));
    expect(frame).toEqual({ width: 390, height: 500, top: 80, left: 0, bottom: 264, coveredHeight: 344 });
    expect(frame!.top + frame!.height).toBe(layout.height - frame!.bottom);
  });

  it("still recognizes covered height when panning consumes the bottom offset", () => {
    expect(projectViewport(layout, visual({ height: 500, offsetTop: 344 }))).toMatchObject({ top: 344, bottom: 0, coveredHeight: 344 });
  });

  it("projects edges even if the visual viewport extends past the layout bottom", () => {
    expect(projectViewport(layout, visual({ height: 500, offsetTop: 400 }))).toMatchObject({ top: 400, bottom: -56 });
  });

  it("does not follow pinch-zoom panning or reflow the app at a zoomed size", () => {
    expect(projectViewport(layout, visual({ scale: 2, width: 195, height: 422, offsetTop: 150 }))).toBeNull();
  });

  it("retains fractional CSS pixels", () => {
    expect(projectViewport(layout, visual({ height: 500.5, offsetTop: 80.25 }))).toMatchObject({ height: 500.5, top: 80.25, bottom: 263.25 });
  });

  it("handles landscape and keyboard dismissal without a remembered keyboard size", () => {
    expect(projectViewport({ width: 844, height: 390 }, visual({ width: 844, height: 220, offsetLeft: 0 }))).toMatchObject({ width: 844, height: 220, bottom: 170, coveredHeight: 170 });
    expect(projectViewport(layout, visual())).toMatchObject({ top: 0, height: 844, bottom: 0, coveredHeight: 0 });
  });

  it("ignores incomplete or non-finite viewport measurements", () => {
    expect(projectViewport(layout, visual({ height: 0 }))).toBeNull();
    expect(projectViewport(layout, visual({ offsetTop: Number.NaN }))).toBeNull();
    expect(projectViewport(layout, visual({ width: Number.POSITIVE_INFINITY }))).toBeNull();
  });
});
