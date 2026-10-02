export const AUTH_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const AUTH_SESSION_STARTED_AT_KEY = "joinly_auth_started_at";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getAuthSessionStartedAt(): number | null {
  if (!canUseStorage()) return null;

  const raw = window.localStorage.getItem(AUTH_SESSION_STARTED_AT_KEY);

  if (!raw) return null;

  const value = Number(raw);

  return Number.isFinite(value) && value > 0 ? value : null;
}

export function ensureAuthSessionStartedAt(): number {
  const existing = getAuthSessionStartedAt();

  if (existing) return existing;

  const startedAt = Date.now();

  if (canUseStorage()) {
    window.localStorage.setItem(AUTH_SESSION_STARTED_AT_KEY, String(startedAt));
  }

  return startedAt;
}

export function clearAuthSessionStartedAt() {
  if (!canUseStorage()) return;

  window.localStorage.removeItem(AUTH_SESSION_STARTED_AT_KEY);
}

export function getAuthSessionRemainingMs(startedAt = getAuthSessionStartedAt()) {
  if (!startedAt) {
    return AUTH_SESSION_MAX_AGE_MS;
  }

  return AUTH_SESSION_MAX_AGE_MS - (Date.now() - startedAt);
}

export function isAuthSessionExpired(startedAt = getAuthSessionStartedAt()) {
  return Boolean(startedAt && getAuthSessionRemainingMs(startedAt) <= 0);
}
