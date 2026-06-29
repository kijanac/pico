import { getJsonPreference, removePreference, setJsonPreference } from "@/shared/mobile/preferences";

type StoredChatDraft = {
  text: string;
  updatedAt: number;
  version: 1;
};

const draftKey = (hostId: string, sessionId: string): string => `chat:draft:${hostId}:${sessionId}`;
const legacyDraftKey = (sessionId: string): string => `chat:draft:${sessionId}`;

export async function loadChatDraft(hostId: string, sessionId: string): Promise<string> {
  const draft = await getJsonPreference<Partial<StoredChatDraft> | null>(draftKey(hostId, sessionId), null);
  if (typeof draft?.text === "string") return draft.text;

  const legacyDraft = await getJsonPreference<Partial<StoredChatDraft> | null>(legacyDraftKey(sessionId), null);
  return typeof legacyDraft?.text === "string" ? legacyDraft.text : "";
}

export async function saveChatDraft(hostId: string, sessionId: string, text: string): Promise<void> {
  if (text.trim().length === 0) {
    await clearChatDraft(hostId, sessionId);
    return;
  }

  await setJsonPreference(draftKey(hostId, sessionId), {
    text,
    updatedAt: Date.now(),
    version: 1,
  } satisfies StoredChatDraft);
}

export async function clearChatDraft(hostId: string, sessionId: string): Promise<void> {
  await removePreference(draftKey(hostId, sessionId));
  await removePreference(legacyDraftKey(sessionId));
}
