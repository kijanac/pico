const draftKey = (sessionId: string): string => `chat:draft:${sessionId}`;

export function loadChatDraft(sessionId: string): string {
  return localStorage.getItem(draftKey(sessionId)) ?? "";
}

export function saveChatDraft(sessionId: string, text: string): void {
  if (text.trim()) localStorage.setItem(draftKey(sessionId), text);
  else clearChatDraft(sessionId);
}

export function clearChatDraft(sessionId: string): void {
  localStorage.removeItem(draftKey(sessionId));
}
