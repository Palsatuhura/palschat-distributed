/**
 * Forgot password: token helpers, the mail sender, and both endpoints with
 * stand-in models (no database, no real email).
 * Run with: npm test
 */
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.APP_URL = "https://app.example.com/";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "..");
const stub = (rel, exports) => {
  const file = path.join(root, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

// The real mailer is loaded first, because the controller gets a stand-in.
const real = require(path.join(root, "src/utils/mailer.js"));

// ── stand-ins ────────────────────────────────────────────────────────────
let users = [];
let sessions = [];
let sent = [];
let ended = [];

const matches = (u, q) =>
  Object.entries(q).every(([k, v]) => {
    if (v && typeof v === "object" && "$gt" in v) return u[k] && u[k] > v.$gt;
    return u[k] === v;
  });
const query = (rows) => ({ select: () => Promise.resolve(rows[0] || null) });

stub("src/models/User.js", {
  findOne: (q) => query(users.filter((u) => matches(u, q))),
  updateOne: async ({ _id }, { $set }) => Object.assign(users.find((u) => u._id === _id), $set),
});
stub("src/models/Session.js", {
  find: (q) => ({ select: () => Promise.resolve(sessions.filter((s) => s.user === q.user)) }),
  deleteMany: async (q) => {
    sessions = sessions.filter((s) => s.user !== q.user);
  },
});
stub("src/utils/sessionService.js", {
  endSessionsLive: (_io, ids) => ended.push(...ids),
});
stub("src/utils/mailer.js", {
  sendMail: async (m) => {
    sent.push(m);
    return true;
  },
});

const h = require(path.join(root, "src/utils/passwordReset.js"));
const { forgotPassword, resetPassword } = require(path.join(root, "src/controllers/passwordResetController.js"));
const call = async (fn, body) => {
  const res = {
    code: 200,
    body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await fn({ body, app: { get: () => ({}) } }, res);
  return res;
};
const reset = () => {
  users = [{ _id: "u1", name: "Amina", email: "amina@example.com", password: "old-password", save: async () => {} }];
  sessions = [{ _id: "s1", user: "u1" }, { _id: "s2", user: "u1" }];
  sent = [];
  ended = [];
};
const tokenFromMail = () => /token=([a-f0-9]{64})/.exec(sent[0].text)[1];

// ── helpers ──────────────────────────────────────────────────────────────
test("tokens are 64 hex characters, random, and only their hash is stored", () => {
  const a = h.newResetToken();
  const b = h.newResetToken();
  assert.match(a.token, /^[a-f0-9]{64}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, h.hashResetToken(a.token));
  assert.notEqual(a.hash, a.token);
  assert.equal(h.isValidTokenShape(a.token), true);
  for (const bad of ["", "abc", "g".repeat(64), "A".repeat(64), null, undefined, 5, { $ne: "" }, ["x"]]) {
    assert.equal(h.isValidTokenShape(bad), false);
  }
});

test("resetLink joins the address and token without a double slash", () => {
  assert.equal(h.resetLink("https://a.com/", "t"), "https://a.com/reset-password?token=t");
});

test("issuedRecently: only within a minute of issuing", () => {
  const now = Date.now();
  assert.equal(h.issuedRecently(new Date(now + h.RESET_TTL_MS - 5000), now), true);
  assert.equal(h.issuedRecently(new Date(now + h.RESET_TTL_MS - 120000), now), false);
  assert.equal(h.issuedRecently(undefined, now), false);
});

test("mailer does nothing without settings, and sends the right request with them", async () => {
  assert.equal(real.isMailConfigured({}), false);
  assert.equal(await real.sendMail({ to: "a@b.c", subject: "s", text: "t" }, {}), false);

  let seen;
  const fakeFetch = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 201 };
  };
  const env = { BREVO_API_KEY: "key", MAIL_FROM: "me@example.com" };
  assert.equal(await real.sendMail({ to: "a@b.c", subject: "s", text: "t" }, env, fakeFetch), true);
  assert.equal(seen.opts.headers["api-key"], "key");
  const sentBody = JSON.parse(seen.opts.body);
  assert.deepEqual(sentBody.to, [{ email: "a@b.c" }]);
  assert.equal(sentBody.sender.email, "me@example.com");

  await assert.rejects(() => real.sendMail({ to: "a@b.c", subject: "s", text: "t" }, env, async () => ({ ok: false, status: 401 })));
});

// ── endpoints ────────────────────────────────────────────────────────────
test("forgot password: same answer for a known and an unknown email; mail only for the known", async () => {
  reset();
  const known = await call(forgotPassword, { email: " Amina@Example.com " });
  const unknown = await call(forgotPassword, { email: "nobody@example.com" });
  assert.equal(known.code, 200);
  assert.deepEqual(known.body, unknown.body);
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "amina@example.com");
  assert.match(sent[0].text, /^.*Amina[\s\S]*https:\/\/app\.example\.com\/reset-password\?token=[a-f0-9]{64}/);
  // the database holds a hash, never the token itself
  assert.notEqual(users[0].resetTokenHash, tokenFromMail());
  assert.equal(users[0].resetTokenHash, h.hashResetToken(tokenFromMail()));
});

test("forgot password: bad input is refused and a second request within a minute sends nothing", async () => {
  reset();
  assert.equal((await call(forgotPassword, { email: { $ne: "" } })).code, 400);
  assert.equal((await call(forgotPassword, {})).code, 400);
  await call(forgotPassword, { email: "amina@example.com" });
  await call(forgotPassword, { email: "amina@example.com" });
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
});

test("reset: the link works once, sets the password and signs out every device", async () => {
  reset();
  await call(forgotPassword, { email: "amina@example.com" });
  await new Promise((r) => setImmediate(r));
  const token = tokenFromMail();

  const ok = await call(resetPassword, { token, newPassword: "a-brand-new-password" });
  assert.equal(ok.code, 200);
  assert.equal(users[0].password, "a-brand-new-password"); // model hook hashes it in real use
  assert.equal(users[0].resetTokenHash, undefined);
  assert.deepEqual(ended.sort(), ["s1", "s2"].sort());
  assert.equal(sessions.length, 0);

  const again = await call(resetPassword, { token, newPassword: "another-password-1" });
  assert.equal(again.code, 400); // used up
});

test("reset: wrong, malformed or expired links and weak passwords are refused", async () => {
  reset();
  await call(forgotPassword, { email: "amina@example.com" });
  await new Promise((r) => setImmediate(r));
  const token = tokenFromMail();

  assert.equal((await call(resetPassword, { token: "x", newPassword: "a-brand-new-password" })).code, 400);
  assert.equal((await call(resetPassword, { token: "0".repeat(64), newPassword: "a-brand-new-password" })).code, 400);
  assert.equal((await call(resetPassword, { token: { $ne: "" }, newPassword: "a-brand-new-password" })).code, 400);
  assert.equal((await call(resetPassword, { token, newPassword: "short" })).code, 400);
  assert.equal(users[0].password, "old-password");

  users[0].resetExpiresAt = new Date(Date.now() - 1000); // expired
  assert.equal((await call(resetPassword, { token, newPassword: "a-brand-new-password" })).code, 400);
  assert.equal(users[0].password, "old-password");
});
