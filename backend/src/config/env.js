/**
 * Startup validation of environment variables.
 *
 * A server that boots with a weak or missing secret is worse than one that
 * refuses to start, so index.js calls this before doing anything else and
 * exits if there are errors.
 *
 * This file has no dependencies so it can be unit tested on its own.
 */

const MIN_JWT_SECRET_LENGTH = 32;

// Login tokens last 24 hours unless JWT_EXPIRES_IN says otherwise.
const DEFAULT_TOKEN_SECONDS = 24 * 60 * 60;
const MIN_TOKEN_SECONDS = 10;
// There is no server-side revocation, so a leaked token stays valid until it
// expires. Beyond a week that window is hard to defend.
const LONG_TOKEN_SECONDS = 7 * 24 * 60 * 60;

const UNIT_SECONDS = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60, w: 7 * 24 * 60 * 60 };

/**
 * Parse a token lifetime such as "30m", "12h", "1d", "2w" or a bare number of
 * seconds ("3600"). Returns whole seconds, or null if the text is not valid.
 *
 * Always converting to a number of seconds matters: jsonwebtoken reads a bare
 * numeric STRING such as "3600" as milliseconds, which would silently make
 * tokens expire in 3.6 seconds.
 */
const parseDurationSeconds = (value) => {
  const text = String(value).trim().toLowerCase();

  if (/^\d+$/.test(text)) return Number(text);

  const match = text.match(/^(\d+)\s*([smhdw])$/);
  if (!match) return null;

  return Number(match[1]) * UNIT_SECONDS[match[2]];
};

/**
 * The token lifetime in seconds for a raw JWT_EXPIRES_IN value (or the
 * default when it is unset or invalid; invalid values are reported by
 * validateEnv at startup, so this never throws).
 */
const resolveTokenSeconds = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return DEFAULT_TOKEN_SECONDS;
  }

  const seconds = parseDurationSeconds(raw);
  return seconds !== null && seconds >= MIN_TOKEN_SECONDS ? seconds : DEFAULT_TOKEN_SECONDS;
};

// Fragments that show up in example/placeholder secrets copied from tutorials.
const PLACEHOLDER_FRAGMENTS = [
  "your_super_secret",
  "change_this",
  "changeme",
  "secret_key_here",
  "replace_me",
  "example",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * @param {Record<string, string | undefined>} env  usually process.env
 * @returns {{ errors: string[], warnings: string[] }}
 */
const validateEnv = (env) => {
  const errors = [];
  const warnings = [];

  // ── JWT secret ───────────────────────────────────────────────────────────
  const secret = env.JWT_SECRET;

  if (!secret) {
    errors.push("JWT_SECRET is not set.");
  } else {
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
      errors.push(
        `JWT_SECRET is too short (${secret.length} characters; need at least ${MIN_JWT_SECRET_LENGTH}).`
      );
    }

    const lower = secret.toLowerCase();
    if (PLACEHOLDER_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
      errors.push("JWT_SECRET looks like a placeholder. Generate a real random secret.");
    }
  }

  // ── Token lifetime ───────────────────────────────────────────────────────
  if (env.JWT_EXPIRES_IN !== undefined && String(env.JWT_EXPIRES_IN).trim() !== "") {
    const seconds = parseDurationSeconds(env.JWT_EXPIRES_IN);

    if (seconds === null) {
      errors.push(
        `JWT_EXPIRES_IN "${env.JWT_EXPIRES_IN}" is not valid. Use a number plus s, m, h, d or w (for example 30m, 12h, 1d) or a number of seconds.`
      );
    } else if (seconds < MIN_TOKEN_SECONDS) {
      errors.push(`JWT_EXPIRES_IN must be at least ${MIN_TOKEN_SECONDS} seconds.`);
    } else if (seconds > LONG_TOKEN_SECONDS) {
      warnings.push(
        "JWT_EXPIRES_IN is longer than 7 days. Tokens cannot be revoked, so a leaked token stays usable until it expires."
      );
    }
  }

  // ── Diagnostics that must not stay on ────────────────────────────────────
  if (env.DEBUG_CLIENT_IP === "true") {
    warnings.push(
      "DEBUG_CLIENT_IP is enabled: /api/debug/client-ip is public. Remove it once you have measured TRUST_PROXY."
    );
  }

  // ── Required connection strings ──────────────────────────────────────────
  if (!env.MONGO_URI) errors.push("MONGO_URI is not set.");
  if (!env.REDIS_URL) errors.push("REDIS_URL is not set.");

  // A remote Redis (such as Upstash) must be reached over TLS (rediss://).
  if (env.REDIS_URL && /^redis:\/\//i.test(env.REDIS_URL)) {
    try {
      const { hostname } = new URL(env.REDIS_URL);
      if (!LOCAL_HOSTS.has(hostname)) {
        warnings.push(
          "REDIS_URL uses redis:// to a non-local host. Use rediss:// so traffic is encrypted."
        );
      }
    } catch {
      errors.push("REDIS_URL is not a valid URL.");
    }
  }

  // ── CORS ─────────────────────────────────────────────────────────────────
  if (env.CORS_ORIGINS) {
    const origins = env.CORS_ORIGINS.split(",").map((o) => o.trim());
    if (origins.includes("*")) {
      errors.push(
        'CORS_ORIGINS must not contain "*" because credentials are enabled. List the exact origins.'
      );
    }
  }

  // ── Reverse proxy ────────────────────────────────────────────────────────
  // "true" would trust every X-Forwarded-For header and let clients fake
  // their IP address, defeating the rate limiter.
  if (env.TRUST_PROXY && env.TRUST_PROXY.trim().toLowerCase() === "true") {
    errors.push(
      'TRUST_PROXY must be a number of proxy hops (for example "1"), not "true".'
    );
  }

  return { errors, warnings };
};

module.exports = {
  validateEnv,
  parseDurationSeconds,
  resolveTokenSeconds,
  MIN_JWT_SECRET_LENGTH,
  DEFAULT_TOKEN_SECONDS,
};
