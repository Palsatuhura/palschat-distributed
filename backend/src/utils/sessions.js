/**
 * Pure helpers for login sessions (no database, no sockets), so they can be
 * tested on their own.
 */

const DAY_SECONDS = 24 * 60 * 60;

// A login can be renewed quietly while it is in use, but never past this.
const DEFAULT_SESSION_MAX_DAYS = 30;

// lastSeenAt is only written when it is older than this (saves a database
// write on every request).
const TOUCH_AFTER_MS = 5 * 60 * 1000;

/** Longest a login may last, in seconds (SESSION_MAX_DAYS, default 30). */
const sessionMaxSeconds = (raw = process.env.SESSION_MAX_DAYS) => {
  const days = Number.parseInt(raw, 10);
  return (Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_SESSION_MAX_DAYS) * DAY_SECONDS;
};

/**
 * Lifetime for a freshly signed token: the normal token lifetime, but never
 * beyond the end of the session. Returns whole seconds, or 0 when the session
 * has (almost) run out.
 */
const tokenSecondsFor = (sessionExpiresAt, tokenSeconds, now = Date.now()) => {
  const remaining = Math.floor((new Date(sessionExpiresAt).getTime() - now) / 1000);
  if (!Number.isFinite(remaining) || remaining < 60) return 0;
  return Math.min(tokenSeconds, remaining);
};

const shouldTouch = (lastSeenAt, now = Date.now()) => {
  const last = new Date(lastSeenAt).getTime();
  return !Number.isFinite(last) || now - last > TOUCH_AFTER_MS;
};

/** "Chrome on Windows" from a User-Agent header. Never throws. */
const describeDevice = (userAgent) => {
  const ua = typeof userAgent === "string" ? userAgent.slice(0, 300) : "";
  if (!ua) return "Unknown device";

  // Order matters: Edge and Opera also say "Chrome"; Chrome also says "Safari".
  let browser = "Browser";
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/SamsungBrowser\//.test(ua)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "";
  if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/CrOS/.test(ua)) os = "Chromebook";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "Mac";
  else if (/Linux/.test(ua)) os = "Linux";

  return os ? `${browser} on ${os}` : browser;
};

module.exports = {
  DEFAULT_SESSION_MAX_DAYS,
  TOUCH_AFTER_MS,
  sessionMaxSeconds,
  tokenSecondsFor,
  shouldTouch,
  describeDevice,
};
