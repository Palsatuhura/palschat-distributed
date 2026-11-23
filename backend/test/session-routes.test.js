/**
 * Login sessions, tested through the real controllers and middleware with
 * stand-in models (no database). Checks that a token only works while its
 * session exists, that nobody can end someone else's session, renewal, sign
 * out everywhere, and the password-change rules.
 * Run with: npm test
 */
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.JWT_EXPIRES_IN = "1d";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const bcrypt = require("bcryptjs");

const root = path.resolve(__dirname, "..");
const oid = (n) => n.toString(16).padStart(24, "0");
const [ALICE, BOB] = [oid(1), oid(2)];

// ── tiny in-memory stand-ins ─────────────────────────────────────────────
let sessions = [];
let nextId = 100;
let users = {};

const matches = (doc, q) =>
  Object.entries(q).every(([k, v]) => {
    if (v && typeof v === "object" && "$gt" in v) return doc[k] > v.$gt;
    if (v && typeof v === "object" && "$ne" in v) return String(doc[k]) !== String(v.$ne);
    return String(doc[k]) === String(v);
  });

const chain = (rows) => ({
  sort() { return this; },
  limit() { return this; },
  select() { return this; },
  then(resolve) { resolve(rows); },
});

const Session = {
  create: async (data) => {
    const doc = { _id: oid(nextId++), createdAt: new Date(), lastSeenAt: new Date(), ...data };
    sessions.push(doc);
    return doc;
  },
  findOne: async (q) => sessions.find((s) => matches(s, q)) || null,
  find: (q) => chain(sessions.filter((s) => matches(s, q))),
  updateOne: async () => ({}),
  deleteOne: async (q) => {
    const i = sessions.findIndex((s) => matches(s, q));
    if (i >= 0) sessions.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  },
  deleteMany: async (q) => {
    const before = sessions.length;
    sessions = sessions.filter((s) => !matches(s, q));
    return { deletedCount: before - sessions.length };
  },
};

const User = {
  findById: (id) => ({
    select() {
      const u = users[String(id)];
      return Promise.resolve(u || null);
    },
  }),
};

const stub = (rel, exports) => {
  const file = path.join(root, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub("src/models/Session.js", Session);
stub("src/models/User.js", User);

const { createSession, sessionRoom } = require(path.join(root, "src/utils/sessionService.js"));
const { authenticate } = require(path.join(root, "src/utils/authenticate.js"));
const { protect } = require(path.join(root, "src/middleware/auth.js"));
const ctl = require(path.join(root, "src/controllers/sessionController.js"));
const { signToken, verifyToken } = require(path.join(root, "src/utils/jwt.js"));

const events = [];
const io = {
  in(room) {
    return {
      emit: (event) => events.push(["emit", room, event]),
      disconnectSockets: () => events.push(["disconnect", room]),
    };
  },
};

const mkUser = async (id, password = "old-password-1") => {
  const u = {
    _id: id,
    name: "U" + id.slice(-1),
    password: await bcrypt.hash(password, 4),
    // Stand-in for the model's pre-save hook, which hashes a changed password.
    async save() {
      if (!this.password.startsWith("$2")) this.password = await bcrypt.hash(this.password, 4);
      users[String(id)] = this;
    },
  };
  users[String(id)] = u;
  return u;
};

const reset = async () => {
  sessions = [];
  users = {};
  events.length = 0;
  await mkUser(ALICE);
  await mkUser(BOB);
};

const run = async (fn, req) => {
  const out = {};
  const res = {
    status(c) { out.c = c; return this; },
    json(j) { out.j = j; },
  };
  await fn({ app: { get: () => io }, params: {}, body: {}, headers: {}, ...req }, res);
  return out;
};

const login = async (userId, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36") => {
  const { session, token } = await createSession(users[userId], { headers: { "user-agent": ua } });
  return { session, token };
};

const viaMiddleware = async (token) => {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const out = {};
  let passed = false;
  await protect(
    req,
    { status(c) { out.c = c; return this; }, json(j) { out.j = j; } },
    () => { passed = true; }
  );
  return { passed, req, ...out };
};

// ── tests ────────────────────────────────────────────────────────────────

test("login makes a session and a token that names it", async () => {
  await reset();
  const { session, token } = await login(ALICE);
  const payload = verifyToken(token);
  assert.equal(payload.id, ALICE);
  assert.equal(payload.sid, String(session._id));
  assert.equal(session.device, "Chrome on Windows");
  assert.equal(sessions.length, 1);
});

test("a token works only while its session exists", async () => {
  await reset();
  const { session, token } = await login(ALICE);
  assert.equal((await viaMiddleware(token)).passed, true);

  sessions = []; // the session was ended
  const after = await viaMiddleware(token);
  assert.equal(after.passed, false);
  assert.equal(after.c, 401);
  assert.equal(after.j.code, "SESSION_ENDED");
  assert.ok(session);
});

test("tokens without a session id, or with someone else's session, are refused", async () => {
  await reset();
  const bobLogin = await login(BOB);

  // old-style token: no sid
  const jwt = require("jsonwebtoken");
  const legacy = jwt.sign({ id: ALICE }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: 600 });
  const r1 = await viaMiddleware(legacy);
  assert.equal(r1.passed, false);
  assert.equal(r1.j.code, "TOKEN_INVALID");

  // Alice's id with Bob's session id
  const forged = signToken(ALICE, bobLogin.session._id, 600);
  const r2 = await viaMiddleware(forged);
  assert.equal(r2.passed, false);
  assert.equal(r2.j.code, "SESSION_ENDED");

  assert.equal((await viaMiddleware(undefined)).j.code, "NO_TOKEN");
  assert.equal((await viaMiddleware("garbage")).j.code, "TOKEN_INVALID");
});

test("a session past its end is refused", async () => {
  await reset();
  const { session, token } = await login(ALICE);
  session.expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(authenticate(token), /session has ended/i);
});

test("refresh gives a new token for the SAME session, and never beyond its end", async () => {
  await reset();
  const { session } = await login(ALICE);

  const r = await run(ctl.refresh, { user: users[ALICE], session });
  assert.equal(r.c, 200);
  const payload = verifyToken(r.j.token);
  assert.equal(payload.sid, String(session._id));

  // 2 hours of session left: the new token lasts at most 2 hours
  session.expiresAt = new Date(Date.now() + 2 * 3600 * 1000);
  const short = await run(ctl.refresh, { user: users[ALICE], session });
  const p2 = verifyToken(short.j.token);
  assert.ok(p2.exp - Math.floor(Date.now() / 1000) <= 2 * 3600);

  // session about to end: refuse
  session.expiresAt = new Date(Date.now() + 10 * 1000);
  const over = await run(ctl.refresh, { user: users[ALICE], session });
  assert.equal(over.c, 401);
});

test("list shows only my sessions and marks the current one", async () => {
  await reset();
  const a1 = await login(ALICE);
  await login(ALICE, "Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile Safari/537.36");
  await login(BOB);

  const r = await run(ctl.listSessions, { user: users[ALICE], session: a1.session });
  assert.equal(r.j.length, 2);
  assert.equal(r.j.filter((s) => s.current).length, 1);
  assert.ok(r.j.some((s) => s.device === "Chrome on Android"));
});

test("you can end your own sessions, never someone else's", async () => {
  await reset();
  const a1 = await login(ALICE);
  const a2 = await login(ALICE);
  const b1 = await login(BOB);

  const other = await run(ctl.revokeSession, {
    user: users[ALICE], session: a1.session, params: { id: String(b1.session._id) },
  });
  assert.equal(other.c, 404);
  assert.equal(sessions.length, 3);

  const mine = await run(ctl.revokeSession, {
    user: users[ALICE], session: a1.session, params: { id: String(a2.session._id) },
  });
  assert.equal(mine.c, 200);
  assert.equal(mine.j.current, false);
  assert.equal(sessions.length, 2);
  assert.ok(events.some((e) => e[0] === "disconnect" && e[1] === sessionRoom(a2.session._id)));

  const bad = await run(ctl.revokeSession, {
    user: users[ALICE], session: a1.session, params: { id: "nope" },
  });
  assert.equal(bad.c, 400);
});

test("logout ends this session only; logout-all ends every one of mine", async () => {
  await reset();
  const a1 = await login(ALICE);
  await login(ALICE);
  const b1 = await login(BOB);

  await run(ctl.logout, { headers: { authorization: `Bearer ${a1.token}` } });
  assert.equal(sessions.filter((s) => s.user === ALICE).length, 1);

  await run(ctl.logoutAll, { user: users[ALICE], session: a1.session });
  assert.equal(sessions.filter((s) => s.user === ALICE).length, 0);
  assert.equal(sessions.filter((s) => s.user === BOB).length, 1);
  assert.ok(b1);
});

test("logout still removes the session when the token has just expired, and refuses forged tokens", async () => {
  await reset();
  const a1 = await login(ALICE);
  const b1 = await login(BOB);
  const jwt = require("jsonwebtoken");

  // forged token (wrong secret) changes nothing
  const forged = jwt.sign({ id: ALICE, sid: String(a1.session._id) }, "some-other-secret-some-other-secret");
  assert.equal((await run(ctl.logout, { headers: { authorization: `Bearer ${forged}` } })).c, 401);
  assert.equal(sessions.filter((s) => s.user === ALICE).length, 1);

  // no token at all
  assert.equal((await run(ctl.logout, {})).c, 401);

  // properly signed but already expired token: the session is still removed
  const expired = jwt.sign(
    { id: ALICE, sid: String(a1.session._id), exp: Math.floor(Date.now() / 1000) - 60 },
    process.env.JWT_SECRET,
    { algorithm: "HS256" }
  );
  assert.equal((await run(ctl.logout, { headers: { authorization: `Bearer ${expired}` } })).c, 200);
  assert.equal(sessions.filter((s) => s.user === ALICE).length, 0);
  assert.equal(sessions.filter((s) => s.user === BOB).length, 1);
  assert.ok(b1);
});

test("change password: needs the right current password, ends the OTHER sessions", async () => {
  await reset();
  const a1 = await login(ALICE);
  const a2 = await login(ALICE);
  const b1 = await login(BOB);
  const req = (body) => ({ user: users[ALICE], session: a1.session, body });

  assert.equal((await run(ctl.changePassword, req({ newPassword: "brand-new-pass" }))).c, 400);
  assert.equal(
    (await run(ctl.changePassword, req({ currentPassword: "wrong-password", newPassword: "brand-new-pass" }))).c,
    401
  );
  assert.equal(
    (await run(ctl.changePassword, req({ currentPassword: "old-password-1", newPassword: "short" }))).c,
    400
  );
  assert.equal(
    (await run(ctl.changePassword, req({ currentPassword: "old-password-1", newPassword: "old-password-1" }))).c,
    400
  );
  assert.equal(sessions.length, 3); // nothing was ended by the failures

  const ok = await run(ctl.changePassword, req({ currentPassword: "old-password-1", newPassword: "brand-new-pass" }));
  assert.equal(ok.c, 200);
  assert.equal(ok.j.endedOtherSessions, 1);
  assert.ok(sessions.some((s) => s._id === a1.session._id)); // this device stays
  assert.ok(!sessions.some((s) => s._id === a2.session._id)); // the other one is gone
  assert.ok(sessions.some((s) => s._id === b1.session._id)); // Bob untouched
  // and the new password really is stored
  assert.equal(await bcrypt.compare("brand-new-pass", users[ALICE].password), true);
});
