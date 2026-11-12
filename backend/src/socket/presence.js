const { withTimeout } = require("../utils/withTimeout");

/**
 * Distributed presence ("who is online") kept in Redis.
 *
 * Two keys, shared by every backend instance:
 *
 *   presence:v2:sockets   sorted set. member = "<userId>:<socketId>",
 *                         score = the moment (ms) that entry EXPIRES.
 *   presence:v2:online    set of user ids that have been announced online.
 *
 * Why expiry times instead of plain sets:
 *   A server that crashes (or is killed, or loses power) never gets to clean
 *   up after itself. If sockets were stored without an expiry, its users
 *   would look online forever ("ghost users"). Here every server renews the
 *   expiry of ITS sockets every few seconds (heartbeat). Entries nobody
 *   renews run out on their own, and sweep() then announces those users
 *   offline.
 *
 * Why "claims":
 *   Several servers may notice the same user going offline at the same time.
 *   SADD/SREM tell us whether WE changed the set (reply 1) or someone else
 *   already did (reply 0), so exactly one server announces each change.
 *
 * Sorted-set commands are sent raw with sendCommand(), which works the same
 * in every version of the redis package.
 */

const SOCKETS_KEY = "presence:v2:sockets";
const ONLINE_KEY = "presence:v2:online";

// An ObjectId is 24 hex characters, so the member splits at a fixed place.
const USER_ID_LENGTH = 24;

const memberOf = (userId, socketId) => `${userId}:${socketId}`;
const userOf = (member) => member.slice(0, USER_ID_LENGTH);

/**
 * Read timing settings from the environment, with safe limits.
 */
const readPresenceConfig = (env = process.env) => {
  const int = (value, fallback, min) => {
    const n = Number.parseInt(value, 10);
    return Number.isInteger(n) && n >= min ? n : fallback;
  };

  const heartbeatMs = int(env.PRESENCE_HEARTBEAT_MS, 30000, 1000);

  return {
    heartbeatMs,
    // An entry survives two missed heartbeats before it counts as dead.
    ttlMs: Math.max(int(env.PRESENCE_TTL_MS, heartbeatMs * 3, 1000), heartbeatMs * 2),
    sweepMs: int(env.PRESENCE_SWEEP_MS, 60000, 1000),
    // After a user's last socket closes, wait this long before announcing
    // "offline": a page refresh reconnects within a second or two.
    graceMs: int(env.PRESENCE_GRACE_MS, 3000, 0),
    commandTimeoutMs: int(env.PRESENCE_COMMAND_TIMEOUT_MS, 1500, 100),
  };
};

const createPresence = ({ redis, ttlMs, commandTimeoutMs = 1500, now = Date.now }) => {
  // Every Redis call is time-limited so a stalled connection cannot hang us.
  const run = (promise) => withTimeout(promise, commandTimeoutMs, "Redis presence call");

  const raw = (...args) => run(redis.sendCommand(args.map(String)));

  // Members whose expiry is still in the future.
  const liveMembers = async () => raw("ZRANGEBYSCORE", SOCKETS_KEY, `(${now()}`, "+inf");

  const liveUserIds = async () => new Set((await liveMembers()).map(userOf));

  return {
    /**
     * Register a socket. Resolves true when this made the user newly
     * "online" (the caller should announce it), false if they already were.
     */
    async addSocket(userId, socketId) {
      await raw("ZADD", SOCKETS_KEY, now() + ttlMs, memberOf(userId, socketId));
      return (await run(redis.sAdd(ONLINE_KEY, userId))) === 1;
    },

    async removeSocket(userId, socketId) {
      await raw("ZREM", SOCKETS_KEY, memberOf(userId, socketId));
    },

    /** Remove many sockets in one command (used at shutdown). */
    async removeSockets(entries) {
      if (entries.length === 0) return;
      await raw("ZREM", SOCKETS_KEY, ...entries.map((e) => memberOf(e.userId, e.socketId)));
    },

    /** Renew the expiry of this server's sockets, in ONE command. */
    async heartbeat(entries) {
      if (entries.length === 0) return;

      const expiresAt = now() + ttlMs;
      const args = [];
      for (const entry of entries) args.push(expiresAt, memberOf(entry.userId, entry.socketId));

      await raw("ZADD", SOCKETS_KEY, ...args);
    },

    /**
     * Try to take the "went offline" announcement for a user. Resolves true
     * only if the user really has no live socket AND this call is the one
     * that removed them from the online set.
     */
    async claimOffline(userId) {
      if ((await liveUserIds()).has(userId)) return false;

      const claimed = (await run(redis.sRem(ONLINE_KEY, userId))) === 1;
      if (!claimed) return false;

      // The user may have connected between the check and the removal.
      // Undo, so they are not shown offline while connected.
      if ((await liveUserIds()).has(userId)) {
        await run(redis.sAdd(ONLINE_KEY, userId));
        return false;
      }

      return true;
    },

    /**
     * Housekeeping, run periodically by every server: forget expired
     * sockets, and find users marked online who have no live socket
     * (crashed server, or leftovers). Resolves the user ids this call
     * claimed; the caller announces each as offline.
     */
    async sweep() {
      await raw("ZREMRANGEBYSCORE", SOCKETS_KEY, "-inf", now());

      const [live, online] = await Promise.all([
        liveUserIds(),
        run(redis.sMembers(ONLINE_KEY)),
      ]);

      const claimed = [];
      for (const userId of online) {
        if (live.has(userId)) continue;
        if ((await run(redis.sRem(ONLINE_KEY, userId))) === 1) claimed.push(userId);
      }

      return claimed;
    },

    async onlineUserIds() {
      return run(redis.sMembers(ONLINE_KEY));
    },
  };
};

module.exports = {
  createPresence,
  readPresenceConfig,
  SOCKETS_KEY,
  ONLINE_KEY,
};
