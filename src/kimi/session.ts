const sessionParents: Record<string, string | null> =
  (globalThis as any)._sessionStates || {};
(globalThis as any)._sessionStates = sessionParents;

export function updateSessionParent(sessionId: string, parentId: string | null): void {
  if (sessionId) {
    sessionParents[sessionId] = parentId;
  }
}

export function getSessionParent(sessionId: string): string | null | undefined {
  if (!sessionId) return undefined;
  return sessionParents[sessionId];
}

export function clearSessionParent(sessionId: string): void {
  if (sessionId) delete sessionParents[sessionId];
}
