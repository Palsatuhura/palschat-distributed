/**
 * Helpers for "forgot password".
 *
 * The reset link carries a long random token. Only a SHA-256 hash of it is
 * stored, so someone who reads the database cannot use the stored value to
 * reset anybody's password.
 */
const crypto = require("crypto");

const RESET_TTL_MS = 30 * 60 * 1000; // a link works for 30 minutes
const RESEND_AFTER_MS = 60 * 1000; // at most one email per minute per account

const hashResetToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/** A new random token (sent by email) and its hash (stored). */
const newResetToken = () => {
  const token = crypto.randomBytes(32).toString("hex"); // 64 hex characters
  return { token, hash: hashResetToken(token) };
};

/** Anything that is not exactly 64 hex characters cannot be a real token. */
const isValidTokenShape = (token) => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);

const resetLink = (appUrl, token) => `${String(appUrl).replace(/\/+$/, "")}/reset-password?token=${token}`;

/** Was a link issued less than RESEND_AFTER_MS ago? (expiry minus lifetime = issue time) */
const issuedRecently = (expiresAt, now = Date.now()) => {
  const t = expiresAt instanceof Date ? expiresAt.getTime() : Number(expiresAt);
  if (!Number.isFinite(t)) return false;
  return now - (t - RESET_TTL_MS) < RESEND_AFTER_MS;
};

module.exports = {
  RESET_TTL_MS,
  RESEND_AFTER_MS,
  hashResetToken,
  newResetToken,
  isValidTokenShape,
  resetLink,
  issuedRecently,
};
