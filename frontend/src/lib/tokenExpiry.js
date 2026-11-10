/**
 * Reading the expiry time out of a login token (JWT).
 *
 * This only DECODES the token to learn when it expires, so the UI can sign
 * the user out at the right moment. It does not (and cannot) verify the
 * signature: the server is the only party that decides whether a token is
 * valid. Never use anything read here for an access decision.
 *
 * No imports on purpose, so it can be unit tested with plain Node.
 */

// setTimeout fires immediately for delays above 2^31 - 1 ms (about 24.8 days).
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const decodeBase64Url = (segment) =>
  atob(segment.replace(/-/g, "+").replace(/_/g, "/"));

/**
 * Expiry time in milliseconds since the epoch, or null when the token has no
 * readable `exp` claim.
 */
export const getTokenExpiry = (token) => {
  if (typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const { exp } = JSON.parse(decodeBase64Url(parts[1]));
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
};

/** Milliseconds until the token expires (negative once expired), or null. */
export const msUntilExpiry = (token, now = Date.now()) => {
  const expiry = getTokenExpiry(token);
  return expiry === null ? null : expiry - now;
};

/** True only when the token has a readable expiry that has passed. */
export const isTokenExpired = (token, now = Date.now()) => {
  const remaining = msUntilExpiry(token, now);
  return remaining !== null && remaining <= 0;
};
