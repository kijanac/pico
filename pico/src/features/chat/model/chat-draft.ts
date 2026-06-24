import { getJsonPreference, removePreference, setJsonPreference } from "@/shared/mobile/preferences";

type StoredChatDraft = {
  text: string;
  updatedAt: number;
  version: 1;
};

const draftKey = (sessionId: string): string => `chat:draft:${sessionId}`;

export async function loadChatDraft(sessionId: string): Promise<string> {
  const draft = await getJsonPreference<Partial<StoredChatDraft> | null>(draftKey(sessionId), null);
  return typeof draft?.text === "string" ? draft.text : "";
}

export async function saveChatDraft(sessionId: string, text: string): Promise<void> {
  if (text.trim().length === 0) {
    await clearChatDraft(sessionId);
    return;
  }

  await setJsonPreference(draftKey(sessionId), {
    text,
    updatedAt: Date.now(),
    version: 1,
  } satisfies StoredChatDraft);
}

export async function clearChatDraft(sessionId: string): Promise<void> {
  await removePreference(draftKey(sessionId));
}
