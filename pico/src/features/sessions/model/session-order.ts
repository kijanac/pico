import type { SessionMeta } from "@pico/protocol";

export function sortSessions(sessions: readonly SessionMeta[]): SessionMeta[] {
  return [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id.localeCompare(a.id));
}

export function createSessionOrder(): (sessions: readonly SessionMeta[]) => readonly string[] {
  let previous: readonly string[] = [];
  return (sessions) => {
    if (previous.length === sessions.length && sessions.every((session, index) => session.id === previous[index])) return previous;
    previous = sessions.map((session) => session.id);
    return previous;
  };
}
