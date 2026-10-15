import { describe, expect, it } from "vitest";
import type { SessionControls } from "@pico/protocol";
import { composerControls } from "./composer-controls";

const settings = (levels: readonly string[], value = "high"): SessionControls => ({
  controls: [
    { key: "model", kind: "select", label: "model", value: "test/model", options: [{ value: "test/model", label: "Model name" }] },
    { key: "thinkingLevel", kind: "select", label: "thinking level", value, options: levels.map((level) => ({ value: level, label: level })) },
  ],
});

describe("composer controls", () => {
  it("shows the selected model and thinking labels", () => {
    expect(composerControls(settings(["low", "high", "xhigh"]))).toEqual({ model: "Model name", thinking: "high" });
  });

  it("keeps model selection reachable before controls or providers are available", () => {
    expect(composerControls(null)).toEqual({ model: "model", thinking: null });
    expect(composerControls({ controls: [] })).toEqual({ model: "model", thinking: null });
  });

  it("hides thinking when the current model has no alternative level", () => {
    expect(composerControls(settings(["off"], "off")).thinking).toBeNull();
    expect(composerControls(settings([])).thinking).toBeNull();
    const current = settings(["low", "high"]);
    const thinking = current.controls[1];
    expect(composerControls({ controls: [
      current.controls[0],
      { ...thinking, kind: "select", value: "high", options: [{ value: "low", label: "low", disabled: true }, { value: "high", label: "high" }] },
    ] }).thinking).toBeNull();
  });

  it("preserves an unknown current value rather than inventing a selection", () => {
    expect(composerControls(settings(["low", "high"], "custom")).thinking).toBe("custom");
    expect(composerControls({ controls: [{ key: "model", kind: "select", label: "model", value: "test/missing", options: [] }] }).model).toBe("test/missing");
  });

  it("reflects authoritative model changes and clamped thinking levels", () => {
    expect(composerControls(settings(["low", "high", "xhigh"], "xhigh")).thinking).toBe("xhigh");
    expect(composerControls(settings(["low", "high"], "high")).thinking).toBe("high");
    expect(composerControls(settings(["off"], "off")).thinking).toBeNull();
  });
});
