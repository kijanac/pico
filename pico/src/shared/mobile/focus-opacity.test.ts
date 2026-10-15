import { describe, expect, it } from "vitest";
import { focusViewportChanged, holdFocusOpacity } from "./focus-opacity";

function setup(value = "", priority = "") {
  let opacity = value;
  let importance = priority;
  const style = {
    getPropertyValue: () => opacity,
    getPropertyPriority: () => importance,
    setProperty: (_name: string, next: string, nextPriority = "") => { opacity = next; importance = nextPriority; },
    removeProperty: () => { const previous = opacity; opacity = ""; importance = ""; return previous; },
  };
  return { style, get value() { return opacity; }, get priority() { return importance; } };
}

describe("focus opacity ownership", () => {
  it("holds opacity synchronously until explicitly released", () => {
    const target = setup();
    const release = holdFocusOpacity(target.style);
    expect(target.value).toBe("0");
    expect(target.priority).toBe("important");
    expect(target.value).toBe("0");
    release();
    expect(target.value).toBe("");
  });

  it("removes the temporary property when none existed", () => {
    const target = setup();
    holdFocusOpacity(target.style)();
    expect(target.value).toBe("");
    expect(target.priority).toBe("");
  });

  it("restores an existing inline value and priority", () => {
    const target = setup("0.4", "important");
    holdFocusOpacity(target.style)();
    expect(target.value).toBe("0.4");
    expect(target.priority).toBe("important");
  });

  it("does not overwrite a newer style change", () => {
    const target = setup();
    const release = holdFocusOpacity(target.style);
    target.style.setProperty("opacity", "0.6");
    release();
    expect(target.value).toBe("0.6");
  });

  it("cleanup is idempotent", () => {
    const target = setup();
    const release = holdFocusOpacity(target.style);
    release();
    target.style.setProperty("opacity", "0.7");
    release();
    expect(target.value).toBe("0.7");
  });
});

describe("focus viewport change", () => {
  const initial = { width: 402, height: 812, scale: 1 };

  it("does not release just because another paint occurred", () => {
    expect(focusViewportChanged(initial, { ...initial })).toBe(false);
  });

  it("releases for the shrink recorded on the actual iPhone", () => {
    expect(focusViewportChanged(initial, { ...initial, height: 471 })).toBe(true);
  });

  it("does not interpret a larger viewport as keyboard opening", () => {
    expect(focusViewportChanged(initial, { ...initial, height: 844 })).toBe(false);
  });

  it("releases a trial if orientation changes instead", () => {
    expect(focusViewportChanged(initial, { width: 812, height: 402, scale: 1 })).toBe(true);
  });

  it("releases a trial if zoom changes instead", () => {
    expect(focusViewportChanged(initial, { ...initial, scale: 2 })).toBe(true);
  });
});
