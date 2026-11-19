/**
 * Clear chat, delete chat and delete account, tested through the real
 * controllers with stand-in models (no database).
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "..");
const oid = (n) => n.toString(16).padStart(24, "0");
const [A, B, C] = [1, 2, 3].map(oid);
const CID = oid(50);

const { clearedAtFor, isHiddenFor, viewFor } = require(path.join(root, "src/utils/chatState.js"));

const convs = [];
const calls = [];
const events = [];
const stub = (rel, exports) => {
  const file = path.join(root, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

let dmMembers = [A, B];
stub("src/models/Conversation.js", {
  findOne: (q) => ({
    select: async () =>
      q._id === CID && dmMembers.includes(String(q.participants)) ? { _id: CID } : null,
  }),
  updateOne: async (f, u) => calls.push(["updateOne", f, u]),
  updateMany: async (f, u) => calls.push(["updateMany", f, u]),
  find: async () => convs,
});
const users = { [A]: { _id: A, password: "$hash" } };
stub("src/models/User.js", {
  findById: () => ({ select: async () => users[A] }),
  updateOne: async (f, u) => calls.push(["userUpdate", f, u]),
});
stub("src/models/Session.js", {
  find: () => ({ select: async () => [{ _id: "s1" }] }),
  deleteMany: async (q) => calls.push(["sessionsDeleted", q]),
});
stub("src/utils/sessionService.js", {
  endSessionsLive: (io, ids) => events.push(["endSessionsLive", ids]),
});
const left = [];
stub("src/controllers/groupController.js", {
  removeUserFromGroup: async (req, g, uid) => left.push([String(g._id), uid]),
});
stub("src/utils/constants.js", { MAX_LOGIN_PASSWORD_LENGTH: 128 });
// Stand-in for bcryptjs (works whether or not the package is installed).
const Module = require("module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "bcryptjs") return { compare: async (p) => p === "right-password" };
  return realLoad.call(this, request, ...rest);
};

const chat = require(path.join(root, "src/controllers/chatController.js"));
const account = require(path.join(root, "src/controllers/accountController.js"));

const io = {
  to(r) {
    this._t = r;
    return this;
  },
  emit(e, p) {
    events.push([e, this._t, p]);
  },
};
const call = async (fn, user, params, body) => {
  const out = {};
  const res = {
    status(c) {
      out.c = c;
      return this;
    },
    json(j) {
      out.j = j;
    },
  };
  await fn({ user: { _id: user }, params, body, app: { get: () => io } }, res);
  return out;
};
const reset = () => {
  calls.length = 0;
  events.length = 0;
  left.length = 0;
  convs.length = 0;
};

test("clearedAtFor finds only my own clear time", () => {
  const c = { clearedAt: [{ user: A, at: "2026-01-01T00:00:00Z" }] };
  assert.equal(clearedAtFor(c, A).toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(clearedAtFor(c, B), null);
  assert.equal(clearedAtFor({}, A), null);
});

test("viewFor hides other people's state and a cleared preview", () => {
  const c = {
    clearedAt: [{ user: A, at: "2026-01-02T00:00:00Z" }],
    hiddenFor: [B],
    lastMessage: { createdAt: "2026-01-01T00:00:00Z" },
  };
  const mine = viewFor(c, A);
  assert.equal(mine.lastMessage, null);
  assert.equal("clearedAt" in mine, false);
  assert.equal("hiddenFor" in mine, false);
  // B never cleared: still sees the preview
  assert.ok(viewFor(c, B).lastMessage);
  assert.equal(isHiddenFor(c, B), true);
  assert.equal(isHiddenFor(c, A), false);
});

test("clear chat: members only, for me only, other devices told", async () => {
  reset();
  assert.equal((await call(chat.clearChat, C, { id: CID })).c, 404);
  assert.equal((await call(chat.clearChat, A, { id: "not-an-id" })).c, 404);
  const ok = await call(chat.clearChat, A, { id: CID });
  assert.equal(ok.c, 200);
  assert.ok(calls.some((x) => x[2].$push && String(x[2].$push.clearedAt.user) === A));
  assert.ok(events.some((e) => e[0] === "chat_cleared" && e[1] === "user:" + A));
  assert.equal(events.some((e) => e[1] === "user:" + B), false);
});

test("delete chat hides it for me and clears it", async () => {
  reset();
  assert.equal((await call(chat.deleteChat, C, { id: CID })).c, 404);
  const ok = await call(chat.deleteChat, A, { id: CID });
  assert.equal(ok.c, 200);
  assert.ok(calls.some((x) => x[2].$addToSet && String(x[2].$addToSet.hiddenFor) === A));
  assert.ok(calls.some((x) => x[2].$push));
  assert.ok(events.some((e) => e[0] === "chat_deleted"));
});

test("delete account needs DELETE and the right password", async () => {
  reset();
  assert.equal((await call(account.deleteMe, A, {}, { password: "right-password" })).c, 400);
  assert.equal((await call(account.deleteMe, A, {}, { confirm: "DELETE" })).c, 400);
  const bad = await call(account.deleteMe, A, {}, { confirm: "DELETE", password: "nope" });
  assert.equal(bad.c, 401);
  assert.equal(bad.j.code, undefined); // must not look like an ended session
  assert.equal(calls.length, 0); // nothing changed
});

test("delete account anonymises, leaves groups, closes DMs, ends logins", async () => {
  reset();
  convs.push({ _id: "g1" }, { _id: "g2" });
  const ok = await call(account.deleteMe, A, {}, { confirm: "DELETE", password: "right-password" });
  assert.equal(ok.c, 200);
  assert.deepEqual(left.map((l) => l[0]), ["g1", "g2"]);
  assert.ok(calls.some((x) => x[0] === "updateMany" && x[2].$set.readOnly === true));
  const u = calls.find((x) => x[0] === "userUpdate")[2].$set;
  assert.equal(u.name, "Deleted user");
  assert.equal(u.avatar, "");
  assert.ok(u.deletedAt instanceof Date);
  assert.ok(u.email.endsWith("@deleted.invalid"));
  assert.ok(calls.some((x) => x[0] === "sessionsDeleted"));
  assert.ok(events.some((e) => e[0] === "endSessionsLive"));
  assert.ok(events.some((e) => e[0] === "user_removed"));
});
