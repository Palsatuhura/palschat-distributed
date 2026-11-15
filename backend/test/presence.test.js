/**
 * Presence and Redis-timeout tests (Phase 4). The Redis server is replaced
 * by a small in-memory fake that understands only the commands used.
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { withTimeout } = require("../src/utils/withTimeout");
const {
  createPresence,
  readPresenceConfig,
  SOCKETS_KEY,
  ONLINE_KEY,
} = require("../src/socket/presence");
const { RedisStore, createRateLimiter } = require("../src/middleware/rateLimiter");

const oid = (n) => n.toString(16).padStart(24, "0");
const ALICE = oid(1);
const BOB = oid(2);
const TTL = 90000;

/** Minimal fake Redis shared by "several servers" in a test. */
function makeFakeRedis() {
  const zsets = new Map();
  const sets = new Map();

  const zset = (key) => zsets.get(key) || zsets.set(key, new Map()).get(key);
  const set = (key) => sets.get(key) || sets.set(key, new Set()).get(key);

  // "(123" is exclusive, "-inf"/"+inf" are the ends.
  const bound = (text) => {
    if (text === "-inf") return { value: -Infinity, exclusive: false };
    if (text === "+inf") return { value: Infinity, exclusive: false };
    const exclusive = text.startsWith("(");
    return { value: Number(exclusive ? text.slice(1) : text), exclusive };
  };
  const inRange = (score, min, max) =>
    (min.exclusive ? score > min.value : score >= min.value) &&
    (max.exclusive ? score < max.value : score <= max.value);

  return {
    zsets,
    sets,
    async sendCommand(args) {
      const [command, key, ...rest] = args;

      if (command === "ZADD") {
        let added = 0;
        for (let i = 0; i < rest.length; i += 2) {
          if (!zset(key).has(rest[i + 1])) added += 1;
          zset(key).set(rest[i + 1], Number(rest[i]));
        }
        return added;
      }
      if (command === "ZREM") {
        let removed = 0;
        for (const member of rest) removed += zset(key).delete(member) ? 1 : 0;
        return removed;
      }
      if (command === "ZRANGEBYSCORE") {
        const [min, max] = [bound(rest[0]), bound(rest[1])];
        return [...zset(key)].filter(([, score]) => inRange(score, min, max)).map(([m]) => m);
      }
      if (command === "ZREMRANGEBYSCORE") {
        const [min, max] = [bound(rest[0]), bound(rest[1])];
        let removed = 0;
        for (const [member, score] of [...zset(key)]) {
          if (inRange(score, min, max)) {
            zset(key).delete(member);
            removed += 1;
          }
        }
        return removed;
      }
      throw new Error(`fake redis: unsupported command ${command}`);
    },
    async sAdd(key, member) {
      const had = set(key).has(member);
      set(key).add(member);
      return had ? 0 : 1;
    },
    async sRem(key, member) {
      return set(key).delete(member) ? 1 : 0;
    },
    async sMembers(key) {
      return [...set(key)];
    },
  };
}

/** One "server": presence bound to the shared fake Redis and a shared clock. */
const makeServer = (redis, clock) =>
  createPresence({ redis, ttlMs: TTL, now: () => clock.t });

// ── withTimeout ──────────────────────────────────────────────────────────

test("withTimeout passes a result through, and passes errors through", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 50), /boom/);
});

test("withTimeout rejects when the promise never finishes", async () => {
  const never = new Promise(() => {});
  await assert.rejects(withTimeout(never, 20, "thing"), /thing timed out after 20 ms/);
});

// ── readPresenceConfig ───────────────────────────────────────────────────

test("readPresenceConfig has defaults and enforces safe limits", () => {
  const defaults = readPresenceConfig({});
  assert.equal(defaults.heartbeatMs, 30000);
  assert.equal(defaults.ttlMs, 90000);

  const odd = readPresenceConfig({ PRESENCE_HEARTBEAT_MS: "10000", PRESENCE_TTL_MS: "5000", PRESENCE_GRACE_MS: "x" });
  assert.ok(odd.ttlMs >= odd.heartbeatMs * 2, "an entry must survive a missed heartbeat");
  assert.equal(odd.graceMs, 3000);
});

// ── presence ─────────────────────────────────────────────────────────────

test("the first socket announces online, further sockets do not", async () => {
  const clock = { t: 1000 };
  const server = makeServer(makeFakeRedis(), clock);

  assert.equal(await server.addSocket(ALICE, "s1"), true);
  assert.equal(await server.addSocket(ALICE, "s2"), false);
  assert.deepEqual(await server.onlineUserIds(), [ALICE]);
});

test("a user stays online while any socket remains", async () => {
  const clock = { t: 1000 };
  const server = makeServer(makeFakeRedis(), clock);

  await server.addSocket(ALICE, "s1");
  await server.addSocket(ALICE, "s2");
  await server.removeSocket(ALICE, "s1");

  assert.equal(await server.claimOffline(ALICE), false);
  assert.deepEqual(await server.onlineUserIds(), [ALICE]);
});

test("when the last socket goes, offline is announced exactly once", async () => {
  const clock = { t: 1000 };
  const server = makeServer(makeFakeRedis(), clock);

  await server.addSocket(ALICE, "s1");
  await server.removeSocket(ALICE, "s1");

  assert.equal(await server.claimOffline(ALICE), true);
  assert.equal(await server.claimOffline(ALICE), false);
  assert.deepEqual(await server.onlineUserIds(), []);
});

test("two servers noticing the same departure: only one announces it", async () => {
  const clock = { t: 1000 };
  const redis = makeFakeRedis();
  const serverA = makeServer(redis, clock);
  const serverB = makeServer(redis, clock);

  await serverA.addSocket(ALICE, "s1");
  await serverA.removeSocket(ALICE, "s1");

  const results = await Promise.all([serverA.claimOffline(ALICE), serverB.claimOffline(ALICE)]);
  assert.equal(results.filter(Boolean).length, 1);
});

test("a user reconnecting on another server is not announced offline", async () => {
  const clock = { t: 1000 };
  const redis = makeFakeRedis();
  const serverA = makeServer(redis, clock);
  const serverB = makeServer(redis, clock);

  await serverA.addSocket(ALICE, "s1");
  await serverA.removeSocket(ALICE, "s1");
  assert.equal(await serverB.addSocket(ALICE, "s2"), false, "still marked online: no flicker");

  assert.equal(await serverA.claimOffline(ALICE), false);
  assert.deepEqual(await serverB.onlineUserIds(), [ALICE]);
});

test("a crashed server: its users expire and one sweep announces them offline", async () => {
  const clock = { t: 1000 };
  const redis = makeFakeRedis();
  const crashing = makeServer(redis, clock);
  const survivor = makeServer(redis, clock);

  await crashing.addSocket(ALICE, "s1"); // alice is on the server that will die
  await survivor.addSocket(BOB, "s9");

  clock.t += TTL / 2;
  await survivor.heartbeat([{ userId: BOB, socketId: "s9" }]); // only the survivor renews

  clock.t += TTL / 2 + 1; // alice's entry has now expired, bob's has not
  assert.deepEqual(await survivor.sweep(), [ALICE]);
  assert.deepEqual(await survivor.sweep(), [], "nothing left to announce");
  assert.deepEqual(await survivor.onlineUserIds(), [BOB]);
});

test("heartbeat keeps a connected user online past the original expiry", async () => {
  const clock = { t: 1000 };
  const server = makeServer(makeFakeRedis(), clock);

  await server.addSocket(ALICE, "s1");

  for (let i = 0; i < 5; i += 1) {
    clock.t += TTL / 3;
    await server.heartbeat([{ userId: ALICE, socketId: "s1" }]);
    assert.deepEqual(await server.sweep(), []);
  }

  assert.deepEqual(await server.onlineUserIds(), [ALICE]);
});

test("sweep clears ghosts left in the online set with no sockets at all", async () => {
  const clock = { t: 1000 };
  const redis = makeFakeRedis();
  redis.sets.set(ONLINE_KEY, new Set([ALICE, BOB]));

  const server = makeServer(redis, clock);
  assert.deepEqual((await server.sweep()).sort(), [ALICE, BOB].sort());
  assert.deepEqual(await server.onlineUserIds(), []);
});

test("heartbeat with no sockets sends nothing, and removeSockets handles many", async () => {
  const clock = { t: 1000 };
  const redis = makeFakeRedis();
  const server = makeServer(redis, clock);

  await server.heartbeat([]);
  assert.equal(redis.zsets.get(SOCKETS_KEY), undefined);

  await server.addSocket(ALICE, "s1");
  await server.addSocket(BOB, "s2");
  await server.removeSockets([{ userId: ALICE, socketId: "s1" }, { userId: BOB, socketId: "s2" }]);
  assert.equal(redis.zsets.get(SOCKETS_KEY).size, 0);
});

test("presence calls time out instead of hanging when Redis stalls", async () => {
  const stalled = { sendCommand: () => new Promise(() => {}), sAdd: () => new Promise(() => {}) };
  const server = createPresence({ redis: stalled, ttlMs: TTL, commandTimeoutMs: 30 });

  await assert.rejects(server.addSocket(ALICE, "s1"), /timed out/);
});

// ── RedisStore: timeout and cool-down ────────────────────────────────────

test("RedisStore gives up on a hanging Redis instead of waiting forever", async () => {
  const hanging = { eval: () => new Promise(() => {}), decr: async () => 1 };
  const store = new RedisStore(hanging, { timeoutMs: 30 });

  await assert.rejects(store.increment("k", 1000), /timed out/);
});

test("RedisStore skips Redis during the cool-down, then tries again", async () => {
  let calls = 0;
  let clock = 1000;
  const failing = {
    eval: async () => {
      calls += 1;
      throw new Error("down");
    },
  };
  const store = new RedisStore(failing, { timeoutMs: 30, cooldownMs: 5000, now: () => clock });

  await assert.rejects(store.increment("k", 1000), /down/);
  assert.equal(calls, 1);

  await assert.rejects(store.increment("k", 1000), /cooling down/);
  assert.equal(calls, 1, "Redis was not contacted again during the cool-down");

  clock += 5001;
  await assert.rejects(store.increment("k", 1000), /down/);
  assert.equal(calls, 2);
});

test("the limiter keeps working (using memory) when Redis hangs", async () => {
  const hanging = { eval: () => new Promise(() => {}), decr: async () => 1 };
  const store = new RedisStore(hanging, { timeoutMs: 30 });

  const limiter = createRateLimiter({ name: "t", windowMs: 60000, max: 2, store });

  const run = () =>
    new Promise((resolve) => {
      const req = { ip: "1.2.3.4", headers: {}, socket: { remoteAddress: "1.2.3.4" } };
      const res = {
        statusCode: 200,
        headers: {},
        set(k, v) { this.headers[k] = v; return this; },
        setHeader(k, v) { this.headers[k] = v; },
        status(c) { this.statusCode = c; return this; },
        json() { resolve(this.statusCode); },
        on() {},
      };
      limiter(req, res, () => resolve(200));
    });

  const started = Date.now();
  assert.equal(await run(), 200);
  assert.equal(await run(), 200);
  assert.equal(await run(), 429, "memory fallback still enforces the limit");
  assert.ok(Date.now() - started < 2000, "did not wait on the hanging Redis for every request");
});
