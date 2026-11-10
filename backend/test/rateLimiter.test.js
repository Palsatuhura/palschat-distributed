const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createRateLimiter,
  ipKey,
  hashForKey,
  MemoryStore,
  RedisStore,
} = require("../src/middleware/rateLimiter");
const { createEventLimiter } = require("../src/utils/eventLimiter");

// ─── helpers ────────────────────────────────────────────────────────────────

const fakeRes = () => {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = undefined;
  res.set = (name, value) => { res.headers[name] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

// Runs the middleware once and reports what happened.
const run = async (limiter, req) => {
  const res = fakeRes();
  let passed = false;
  await limiter(req, res, () => { passed = true; });
  return { res, passed };
};

const finish = (res, statusCode) => {
  res.statusCode = statusCode;
  res.emit("finish");
};

// ─── ipKey ──────────────────────────────────────────────────────────────────

test("ipKey leaves IPv4 alone and unwraps IPv4-mapped IPv6", () => {
  assert.equal(ipKey("203.0.113.7"), "203.0.113.7");
  assert.equal(ipKey("::ffff:203.0.113.7"), "203.0.113.7");
});

test("ipKey reduces IPv6 to its /64 prefix so rotating addresses does not evade limits", () => {
  const a = ipKey("2001:db8:abcd:12::1");
  const b = ipKey("2001:db8:abcd:12:ffff:ffff:ffff:ffff");
  const c = ipKey("2001:0db8:abcd:0012:0000:0000:0000:0002");
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(a, "2001:db8:abcd:12::/64");

  assert.notEqual(a, ipKey("2001:db8:abcd:13::1"), "different /64 must differ");
});

test("ipKey handles compressed forms, zone ids and loopback", () => {
  assert.equal(ipKey("::1"), "0:0:0:0::/64");
  assert.equal(ipKey("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(ipKey("2001:db8::"), "2001:db8:0:0::/64");
});

test("ipKey copes with missing or odd input", () => {
  assert.equal(ipKey(undefined), "unknown");
  assert.equal(ipKey(""), "unknown");
  assert.equal(ipKey("not-an-ip"), "not-an-ip");
});

test("hashForKey is deterministic and does not contain the input", () => {
  assert.equal(hashForKey("a@b.co"), hashForKey("a@b.co"));
  assert.notEqual(hashForKey("a@b.co"), hashForKey("c@d.co"));
  assert.equal(hashForKey("a@b.co").includes("a@b.co"), false);
});

// ─── MemoryStore ────────────────────────────────────────────────────────────

test("MemoryStore counts hits and starts a new window after expiry", async () => {
  const store = new MemoryStore();

  assert.equal((await store.increment("k", 50)).count, 1);
  assert.equal((await store.increment("k", 50)).count, 2);

  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal((await store.increment("k", 50)).count, 1, "new window");
  clearInterval(store.timer);
});

test("MemoryStore.sweep removes expired entries only", async () => {
  const store = new MemoryStore();
  await store.increment("old", 10);
  await store.increment("fresh", 60000);

  store.sweep(Date.now() + 1000);

  assert.equal(store.entries.has("old"), false);
  assert.equal(store.entries.has("fresh"), true);
  clearInterval(store.timer);
});

test("MemoryStore.decrement never goes below zero", async () => {
  const store = new MemoryStore();
  await store.increment("k", 1000);
  await store.decrement("k");
  await store.decrement("k");
  assert.equal((await store.increment("k", 1000)).count, 1);
  clearInterval(store.timer);
});

// ─── RedisStore ─────────────────────────────────────────────────────────────

test("RedisStore sets an expiry when the key has none, even if count > 1", async () => {
  const calls = [];
  const client = {
    incr: async () => 5,
    pTTL: async () => -1, // key exists without expiry (earlier crash)
    pExpire: async (key, ms) => calls.push(["pExpire", key, ms]),
  };

  const result = await new RedisStore(client).increment("k", 900);

  assert.deepEqual(calls, [["pExpire", "k", 900]]);
  assert.deepEqual(result, { count: 5, resetMs: 900 });
});

test("RedisStore keeps an existing expiry untouched", async () => {
  const calls = [];
  const client = {
    incr: async () => 2,
    pTTL: async () => 400,
    pExpire: async () => calls.push("pExpire"),
  };

  const result = await new RedisStore(client).increment("k", 900);

  assert.equal(calls.length, 0);
  assert.deepEqual(result, { count: 2, resetMs: 400 });
});

// ─── createRateLimiter ──────────────────────────────────────────────────────

test("limiter allows `max` requests, then answers 429 with Retry-After", async () => {
  const store = new MemoryStore();
  const limiter = createRateLimiter({ name: "t1", windowMs: 60000, max: 3, store, message: "slow down" });
  const req = { ip: "203.0.113.7" };

  for (let i = 0; i < 3; i += 1) {
    assert.equal((await run(limiter, req)).passed, true, `request ${i + 1}`);
  }

  const { res, passed } = await run(limiter, req);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { message: "slow down" });
  assert.ok(Number(res.headers["Retry-After"]) >= 1);
  assert.equal(res.headers["RateLimit-Remaining"], "0");
  clearInterval(store.timer);
});

test("limiter keeps separate budgets per client", async () => {
  const store = new MemoryStore();
  const limiter = createRateLimiter({ name: "t2", windowMs: 60000, max: 1, store });

  assert.equal((await run(limiter, { ip: "203.0.113.1" })).passed, true);
  assert.equal((await run(limiter, { ip: "203.0.113.1" })).passed, false);
  assert.equal((await run(limiter, { ip: "203.0.113.2" })).passed, true);
  clearInterval(store.timer);
});

test("skipSuccessful: successful responses are refunded, failures are not", async () => {
  const store = new MemoryStore();
  const limiter = createRateLimiter({ name: "t3", windowMs: 60000, max: 2, store, skipSuccessful: true });
  const req = { ip: "203.0.113.9" };

  // Ten successful logins in a row never exhaust the budget.
  for (let i = 0; i < 10; i += 1) {
    const { res, passed } = await run(limiter, req);
    assert.equal(passed, true, `success ${i + 1}`);
    finish(res, 200);
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Failures do.
  for (let i = 0; i < 2; i += 1) {
    const { res, passed } = await run(limiter, req);
    assert.equal(passed, true, `failure ${i + 1}`);
    finish(res, 401);
    await new Promise((resolve) => setImmediate(resolve));
  }

  const blocked = await run(limiter, req);
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 429);
  clearInterval(store.timer);
});

test("custom keyFn is used (per-account limiting)", async () => {
  const store = new MemoryStore();
  const limiter = createRateLimiter({
    name: "t4",
    windowMs: 60000,
    max: 1,
    store,
    keyFn: (req) => hashForKey(req.body.email),
  });

  // Same account from two different IPs shares one budget.
  assert.equal((await run(limiter, { ip: "1.1.1.1", body: { email: "a@b.co" } })).passed, true);
  assert.equal((await run(limiter, { ip: "2.2.2.2", body: { email: "a@b.co" } })).passed, false);
  assert.equal((await run(limiter, { ip: "2.2.2.2", body: { email: "c@d.co" } })).passed, true);
  clearInterval(store.timer);
});

test("limiter falls back to memory when the store throws, and never blocks on it", async () => {
  const brokenStore = {
    increment: async () => { throw new Error("redis down"); },
    decrement: async () => {},
  };
  const limiter = createRateLimiter({ name: "t5", windowMs: 60000, max: 1, store: brokenStore });
  const req = { ip: "203.0.113.50" };

  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await run(limiter, req)).passed, true);
    assert.equal((await run(limiter, req)).passed, false, "fallback still enforces the limit");
  } finally {
    console.error = originalError;
  }
});

// ─── per-socket event limiter ───────────────────────────────────────────────

test("eventLimiter allows `max` events per window and flags the first rejection once", () => {
  let time = 1000;
  const limiter = createEventLimiter({ max: 3, windowMs: 100, now: () => time });

  for (let i = 0; i < 3; i += 1) assert.equal(limiter.hit().allowed, true);

  const first = limiter.hit();
  assert.equal(first.allowed, false);
  assert.equal(first.firstRejection, true);

  const second = limiter.hit();
  assert.equal(second.allowed, false);
  assert.equal(second.firstRejection, false);
});

test("eventLimiter starts a fresh window after windowMs", () => {
  let time = 1000;
  const limiter = createEventLimiter({ max: 1, windowMs: 100, now: () => time });

  assert.equal(limiter.hit().allowed, true);
  assert.equal(limiter.hit().allowed, false);

  time += 100;
  assert.equal(limiter.hit().allowed, true);
});

test("eventLimiter marks a socket abusive only far beyond its budget", () => {
  const limiter = createEventLimiter({ max: 2, windowMs: 1000, abusiveFactor: 5, now: () => 0 });
  const results = Array.from({ length: 12 }, () => limiter.hit());

  assert.equal(results[9].abusive, false, "10 events = 5x max: not yet");
  assert.equal(results[10].abusive, true, "11th event exceeds 5x max");
});
