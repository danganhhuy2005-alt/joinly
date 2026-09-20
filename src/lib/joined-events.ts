// Tracks which events the current device/browser has joined, and which room.
// Persisted in localStorage so a participant cannot re-pick a different room
// for the same event without contacting the organizer.

export type JoinedInfo = { roomId: string; roomName: string; token?: string };

const key = (eventId: string) => `joinly:joined:${eventId}`;

export function getJoined(eventId: string): JoinedInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JoinedInfo;
    if (!parsed?.roomId || !parsed?.roomName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setJoined(eventId: string, info: JoinedInfo) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(eventId), JSON.stringify(info));
  } catch {
    // ignore quota / privacy mode errors
  }
}
