const crypto = require("crypto");
const net = require("net");
const { withTimeout } = require("../utils/withTimeout");

/**
 * HTTP rate limiting.
 *
 * Counters live in Redis so that every backend instance (server1, server2,
 * ...) shares one count per client. If Redis is unavailable the limiter
 * falls back to an in-memory counter on that instance: protection becomes
 * per-server instead of global, but it never turns off and never blocks
 * requests just because Redis is down.
 *
 * Algorithm: fixed window. The first hit creates the counter with an expiry
 * of `windowMs`; every later hit increments it.
 */

// ─── Client identity ─────────────────────────────────────────────────────────

/**
 * Turn a client IP into a rate-limit key.
 *
 * - IPv4-mapped IPv6 (::ffff:1.2.3.4) becomes plain IPv4.
 * - IPv6 addresses are reduced to their /64 prefix. A single IPv6 customer
 *   normally controls an entire /64 (2^64 addresses), so limiting by full
 *   address would let one client rotate addresses and never be limited.
 */
const ipKey = (ip) => {
  if (typeof ip !== "string" || !ip) return "unknown";

  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];

  if (net.isIPv4(ip)) return ip;

  const address = ip.split("%")[0]; // drop an IPv6 zone id such as %eth0
  if (!net.isIPv6(address)) return ip;

  // Each part is one 16-bit group, except a trailing dotted IPv4 which is two.
  const width = (parts) => parts.reduce((n, p) => n + (p.includes(".") ? 2 : 1), 0);
  const split = (text) => (text ? text.split(":") : []);

  const [head, tail] = address.split("::");
  const headParts = split(head);
  const tailParts = split(tail);

  const missing = tail === undefined ? 0 : 8 - width(headParts) - width(tailParts);
  const groups = [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts];

  const prefix = groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16));
  return `${prefix.join(":")}::/64`;
};

const hashForKey = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);

// ─── Stores ──────────────────────────────────────────────────────────────────

class MemoryStore {
  constructor() {
    this.entries = new Map();

    // Drop expired counters so the map cannot grow without bound.
    this.timer = setInterval(() => this.sweep(), 60 * 1000);
    this.timer.unref(); // never keep the process alive just for cleanup
  }

  sweep(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }

  async increment(key, windowMs) {
    const now = Date.now();
    let entry = this.entries.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.entries.set(key, entry);
    }

    entry.count += 1;
    return { count: entry.count, resetMs: entry.resetAt - now };
  }

  async decrement(key) {
    const entry = this.entries.get(key);
    if (entry && entry.count > 0) entry.count -= 1;
  }
}

/**
 * One atomic step inside Redis: count this request, and make sure the counter
 * has an expiry. Doing it as a single script means ONE network round trip.
 * With a Redis server on another continent each round trip can cost 300 ms or
 * more, so the old three separate commands (INCR, PTTL, PEXPIRE) took about a
 * second and kept running into the time limit.
 *
 * The expiry is set whenever it is missing (not only on the first hit), so a
 * crash between the steps can never leave a counter that lasts forever and
 * locks a client out permanently.
 */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/**
 * Counters in Redis, shared by every backend instance.
 *
 * Redis must never be able to freeze the API. So every call has a time limit,
 * and after a failure the store "opens its circuit": for a short cooldown it
 * fails immediately instead of waiting on Redis again for every request. The
 * limiter then uses its in-memory counters (per instance only, so limits are
 * looser while Redis is away, but the site keeps working).
 */
class RedisStore {
  constructor(client, { timeoutMs = 2500, cooldownMs = 10000, now = Date.now } = {}) {
    this.client = client;
    this.timeoutMs = timeoutMs;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.downUntil = 0;
  }

  async run(operation) {
    if (this.now() < this.downUntil) {
      const error = new Error("Redis unavailable (cooling down)");
      error.cooldown = true; // already reported when it first failed
      throw error;
    }

    try {
      return await withTimeout(operation(), this.timeoutMs, "Redis rate-limit call");
    } catch (error) {
      this.downUntil = this.now() + this.cooldownMs;
      throw error;
    }
  }

  increment(key, windowMs) {
    return this.run(async () => {
      const [count, resetMs] = await this.client.eval(INCREMENT_SCRIPT, {
        keys: [key],
        arguments: [String(windowMs)],
      });

      return { count: Number(count), resetMs: Number(resetMs) };
    });
  }

  decrement(key) {
    return this.run(() => this.client.decr(key));
  }
}

const memoryStore = new MemoryStore();
let redisStore = null;

/** Called once from index.js after Redis has connected. */
const setRedisClient = (client) => {
  redisStore = client ? new RedisStore(client) : null;
};

// ─── Middleware factory ──────────────────────────────────────────────────────

/**
 * @param {object}   options
 * @param {string}   options.name             short name used in the Redis key
 * @param {number}   options.windowMs         length of the window
 * @param {number}   options.max              requests allowed per window
 * @param {string}   [options.message]        body message for 429 responses
 * @param {boolean}  [options.skipSuccessful] do not count requests that end
 *                                            with a status below 400 (used for
 *                                            login so that only FAILED
 *                                            attempts consume the budget)
 * @param {function} [options.keyFn]          (req) => string; default: client IP
 * @param {object}   [options.store]          override the store (tests)
 */
const createRateLimiter = ({
  name,
  windowMs,
  max,
  message = "Too many requests, please try again later.",
  skipSuccessful = false,
  keyFn = (req) => ipKey(req.ip),
  store: storeOverride,
}) => {
  return async (req, res, next) => {
    const key = `rl:${name}:${keyFn(req)}`;

    let store = storeOverride || redisStore || memoryStore;
    let result;

    try {
      result = await store.increment(key, windowMs);
    } catch (error) {
      // During the cool-down every request would repeat the same message.
      if (!error.cooldown) {
        console.error(`Rate limiter store error (${name}), using memory:`, error.message);
      }
      store = memoryStore;
      result = await store.increment(key, windowMs);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil(result.resetMs / 1000));

    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(Math.max(0, max - result.count)));
    res.set("RateLimit-Reset", String(retryAfterSeconds));

    if (result.count > max) {
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ message });
    }

    if (skipSuccessful) {
      res.on("finish", () => {
        if (res.statusCode < 400) {
          Promise.resolve(store.decrement(key)).catch(() => {});
        }
      });
    }

    return next();
  };
};

// ─── Configured limiters ─────────────────────────────────────────────────────

const intFromEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const MINUTE = 60 * 1000;

// Failed logins per IP address. Generous, so a shared school or office network
// is not locked out by a few typos.
const loginIpLimiter = createRateLimiter({
  name: "login-ip",
  windowMs: 15 * MINUTE,
  max: intFromEnv("RATE_LIMIT_LOGIN_IP_MAX", 30),
  skipSuccessful: true,
  message: "Too many failed login attempts. Please try again in a few minutes.",
});

// Failed logins per account. Stops an attacker spreading guesses for ONE
// account across many IP addresses. Trade-off: someone who knows your email
// can lock you out for the window by failing on purpose.
const loginAccountLimiter = createRateLimiter({
  name: "login-account",
  windowMs: 15 * MINUTE,
  max: intFromEnv("RATE_LIMIT_LOGIN_ACCOUNT_MAX", 10),
  skipSuccessful: true,
  message: "Too many failed login attempts for this account. Please try again in a few minutes.",
  keyFn: (req) => {
    const email = req.body && typeof req.body.email === "string" ? req.body.email : "";
    // Hashed so email addresses never appear in Redis keys.
    return hashForKey(email.trim().toLowerCase());
  },
});

// Wrong "current password" attempts on the change-password form, per
// logged-in user (a stolen login must not be able to guess the password).
const passwordChangeLimiter = createRateLimiter({
  name: "password-change",
  windowMs: 15 * MINUTE,
  max: 10,
  skipSuccessful: true,
  message: "Too many failed attempts. Please try again in a few minutes.",
  keyFn: (req) => String(req.user?._id || ipKey(req.ip)),
});

const registerLimiter = createRateLimiter({
  name: "register",
  windowMs: 60 * MINUTE,
  max: intFromEnv("RATE_LIMIT_REGISTER_MAX", 10),
  message: "Too many accounts created from this network. Please try again later.",
});

// Forgot password: every request counts (it sends an email). Per network and
// per email address, so nobody can fill someone's inbox.
const forgotIpLimiter = createRateLimiter({
  name: "forgot-ip",
  windowMs: 60 * MINUTE,
  max: intFromEnv("RATE_LIMIT_FORGOT_IP_MAX", 10),
  message: "Too many reset requests. Please try again later.",
});
const forgotAccountLimiter = createRateLimiter({
  name: "forgot-account",
  windowMs: 60 * MINUTE,
  max: 3,
  message: "Too many reset requests for this email. Please try again later.",
  keyFn: (req) => {
    const email = req.body && typeof req.body.email === "string" ? req.body.email : "";
    return hashForKey(email.trim().toLowerCase());
  },
});

// Wrong or expired reset links, per network.
const resetLimiter = createRateLimiter({
  name: "reset",
  windowMs: 15 * MINUTE,
  max: 10,
  skipSuccessful: true,
  message: "Too many attempts. Please try again in a few minutes.",
});

// Uploads of pictures and files, per person.
const uploadLimiter = createRateLimiter({
  name: "upload",
  windowMs: 10 * MINUTE,
  max: intFromEnv("RATE_LIMIT_UPLOAD_MAX", 30),
  message: "You are sending files too quickly. Please wait a few minutes.",
  keyFn: (req) => String(req.user?._id || ipKey(req.ip)),
});

// Blanket limit for every other API route.
const apiLimiter = createRateLimiter({
  name: "api",
  windowMs: MINUTE,
  max: intFromEnv("RATE_LIMIT_API_MAX", 300),
});

module.exports = {
  createRateLimiter,
  setRedisClient,
  ipKey,
  hashForKey,
  MemoryStore,
  RedisStore,
  INCREMENT_SCRIPT,
  loginIpLimiter,
  loginAccountLimiter,
  registerLimiter,
  forgotIpLimiter,
  forgotAccountLimiter,
  resetLimiter,
  passwordChangeLimiter,
  uploadLimiter,
  apiLimiter,
};
