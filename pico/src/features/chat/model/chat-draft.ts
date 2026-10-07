const draftKey = (hostId: string, sessionId: string): string => `chat:draft:${hostId}:${sessionId}`;

export function loadChatDraft(hostId: string, sessionId: string): string {
  return localStorage.getItem(draftKey(hostId, sessionId)) ?? "";
}

export function saveChatDraft(hostId: string, sessionId: string, text: string): void {
  if (text.trim()) localStorage.setItem(draftKey(hostId, sessionId), text);
  else clearChatDraft(hostId, sessionId);
}

export function clearChatDraft(hostId: string, sessionId: string): void {
  localStorage.removeItem(draftKey(hostId, sessionId));
}
