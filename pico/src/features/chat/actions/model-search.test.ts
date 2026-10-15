import { describe, expect, it } from "vitest";
import { filterModelOptions, type ModelOption } from "./model-search";

const models: readonly ModelOption[] = [
  { value: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6", description: "Anthropic · reasoning · image" },
  { value: "openai/gpt-5.3", label: "GPT-5.3", description: "OpenAI · reasoning · image" },
  { value: "google/gemini-flash", label: "Gemini Flash", description: "Google · image", disabled: true },
];

describe("model search", () => {
  it("preserves all options and their order for an empty query", () => {
    expect(filterModelOptions(models, " \n ")).toBe(models);
  });

  it("matches model names without case sensitivity", () => {
    expect(filterModelOptions(models, "oPuS")).toEqual([models[0]]);
  });

  it("matches model IDs and provider names", () => {
    expect(filterModelOptions(models, "gemini-flash")).toEqual([models[2]]);
    expect(filterModelOptions(models, "openai")).toEqual([models[1]]);
  });

  it("matches tokens across name, ID, and description", () => {
    expect(filterModelOptions(models, "  anthropic  opus image ")).toEqual([models[0]]);
    expect(filterModelOptions(models, "openai opus")).toEqual([]);
  });

  it("accepts compact spellings of punctuated model IDs", () => {
    expect(filterModelOptions(models, "gpt5")).toEqual([models[1]]);
    expect(filterModelOptions(models, "claude_opus_4.6")).toEqual([models[0]]);
  });

  it("keeps disabled options and their metadata intact", () => {
    expect(filterModelOptions(models, "google")[0]).toBe(models[2]);
    expect(filterModelOptions(models, "google")[0].disabled).toBe(true);
  });

  it("returns no options for an unmatched query", () => {
    expect(filterModelOptions(models, "not-a-model")).toEqual([]);
  });

  it("does not modify options or change their identities while filtering", () => {
    expect(filterModelOptions(models, "image")).toEqual(models);
    expect(filterModelOptions(models, "image")[1]).toBe(models[1]);
    expect(models).toHaveLength(3);
  });
});
