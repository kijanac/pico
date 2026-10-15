import { ImageContent } from "@pico/protocol";
import { Schema } from "effect";

const Draft = Schema.Struct({ text: Schema.String, images: Schema.Array(ImageContent) });
export type ChatDraft = Schema.Schema.Type<typeof Draft>;
export type SavedChatDraft = ChatDraft & { saved: boolean };

const draftKey = (sessionId: string): string => `chat:draft:v2:${sessionId}`;
const legacyKey = (sessionId: string): string => `chat:draft:${sessionId}`;
const copy = (draft: ChatDraft): ChatDraft => ({ text: draft.text, images: draft.images.map((image) => ({ ...image })) });

export function createChatDraftStore(storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  const unsaved = new Map<string, ChatDraft>();

  function load(sessionId: string): SavedChatDraft {
    const cached = unsaved.get(sessionId);
    if (cached) return { ...copy(cached), saved: false };
    try {
      const stored = storage().getItem(draftKey(sessionId));
      const draft = stored === null
        ? { text: storage().getItem(legacyKey(sessionId)) ?? "", images: [] }
        : Schema.decodeUnknownSync(Schema.parseJson(Draft))(stored);
      return { ...copy(draft), saved: true };
    } catch {
      return { text: "", images: [], saved: false };
    }
  }

  function save(sessionId: string, draft: ChatDraft): boolean {
    const next = copy(draft);
    unsaved.set(sessionId, next);
    try {
      if (next.text.trim() || next.images.length > 0) storage().setItem(draftKey(sessionId), JSON.stringify(next));
      else storage().removeItem(draftKey(sessionId));
      storage().removeItem(legacyKey(sessionId));
      unsaved.delete(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  return { load, save, clear: (sessionId: string) => save(sessionId, { text: "", images: [] }) };
}

const drafts = createChatDraftStore(() => localStorage);
export const loadChatDraft = drafts.load;
export const saveChatDraft = drafts.save;
export const clearChatDraft = drafts.clear;
