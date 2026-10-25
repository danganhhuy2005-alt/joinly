/**
 * Joinly has one account, with two workspaces.
 * This preference changes navigation/UI only; permissions remain event-based.
 */
export type WorkspaceMode = "organizer" | "participant";

const storageKey = (userId: string) => `joinly:workspace:${userId}`;

export function getWorkspaceMode(userId: string): WorkspaceMode {
  if (typeof window === "undefined" || !userId) return "organizer";

  try {
    return window.localStorage.getItem(storageKey(userId)) === "participant"
      ? "participant"
      : "organizer";
  } catch {
    return "organizer";
  }
}

export function setWorkspaceMode(userId: string, mode: WorkspaceMode): void {
  if (typeof window === "undefined" || !userId) return;

  try {
    window.localStorage.setItem(storageKey(userId), mode);
  } catch {
    // Browser storage may be unavailable; the current session still works.
  }
}

export function workspaceHome(mode: WorkspaceMode) {
  return mode === "participant" ? "/my-participations" : "/my-events";
}
