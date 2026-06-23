import { v7 as randomUUIDv7 } from "uuid";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionUiRequest, ExtensionUiResponseValue } from "@pico/protocol";

type PendingResponse = (value: ExtensionUiResponseValue) => void;
type DialogOptions = { signal?: AbortSignal; timeout?: number };

type RequestBase = {
  id: string;
  title: string;
  timeoutMs?: number;
};

export interface MobileExtensionUiChannel {
  readonly uiContext: ExtensionUIContext;
  respond(id: string, value: ExtensionUiResponseValue): void;
  close(): void;
}

const EMPTY_THEME = {} as ExtensionUIContext["theme"];

const isStringResponse = (value: ExtensionUiResponseValue): string | undefined =>
  typeof value === "string" ? value : undefined;

const createRequestBase = (title: string, options?: DialogOptions): RequestBase => ({
  id: randomUUIDv7(),
  title,
  ...(options?.timeout !== undefined ? { timeoutMs: options.timeout } : {}),
});

export const createMobileExtensionUiChannel = (
  emit: (request: ExtensionUiRequest) => void,
): MobileExtensionUiChannel => {
  const pending = new Map<string, PendingResponse>();

  const requestValue = <T>(
    request: ExtensionUiRequest,
    fallback: T,
    coerce: (value: ExtensionUiResponseValue) => T,
    options?: DialogOptions,
  ): Promise<T> =>
    new Promise<T>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const settle = (value: T) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        options?.signal?.removeEventListener("abort", onAbort);
        pending.delete(request.id);
        resolve(value);
      };
      const onAbort = () => settle(fallback);

      options?.signal?.addEventListener("abort", onAbort, { once: true });
      if (options?.timeout && options.timeout > 0) {
        timer = setTimeout(onAbort, options.timeout).unref();
      }

      pending.set(request.id, (value) => settle(coerce(value)));
      emit(request);
    });

  const uiContext: ExtensionUIContext = {
    select: (title, options, dialogOptions) =>
      requestValue(
        { kind: "select", ...createRequestBase(title, dialogOptions), options },
        undefined,
        isStringResponse,
        dialogOptions,
      ),
    confirm: (title, message, dialogOptions) =>
      requestValue(
        { kind: "confirm", ...createRequestBase(title, dialogOptions), message },
        false,
        (value) => value === true,
        dialogOptions,
      ),
    input: (title, placeholder, dialogOptions) =>
      requestValue(
        {
          kind: "input",
          ...createRequestBase(title, dialogOptions),
          ...(placeholder !== undefined ? { placeholder } : {}),
        },
        undefined,
        isStringResponse,
        dialogOptions,
      ),
    editor: (title, prefill) =>
      requestValue(
        {
          kind: "input",
          ...createRequestBase(title),
          multiline: true,
          ...(prefill !== undefined ? { initialValue: prefill } : {}),
        },
        undefined,
        isStringResponse,
      ),
    notify: (message, type = "info") => {
      emit({ kind: "notify", id: randomUUIDv7(), message, level: type });
    },
    setStatus: (key, text) => {
      emit({ kind: "status", id: randomUUIDv7(), key, text: text ?? null });
    },
    setWorkingMessage: (message) => {
      emit({ kind: "status", id: randomUUIDv7(), key: "working", text: message ?? null });
    },
    setHiddenThinkingLabel: (label) => {
      emit({ kind: "status", id: randomUUIDv7(), key: "thinking", text: label ?? null });
    },
    setWidget: (key, content) => {
      const text = Array.isArray(content) ? content.join("\n") : undefined;
      emit({ kind: "status", id: randomUUIDv7(), key: `widget:${key}`, text: text ?? null });
    },
    setTitle: (title) => {
      emit({ kind: "status", id: randomUUIDv7(), key: "title", text: title });
    },

    onTerminalInput: () => () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setFooter: () => {},
    setHeader: () => {},
    custom: async () => {
      throw new Error("Pico mobile does not support custom extension TUI components");
    },
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return EMPTY_THEME;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Pico mobile does not support extension TUI themes" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };

  return {
    uiContext,
    respond(id, value) {
      pending.get(id)?.(value);
    },
    close() {
      for (const respond of pending.values()) respond(null);
      pending.clear();
    },
  };
};
