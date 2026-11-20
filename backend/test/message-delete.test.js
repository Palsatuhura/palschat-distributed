/**
 * Deleting messages (for me / for everyone), tested through the real
 * controller with stand-in models. Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "..");
const oid = (n) => n.toString(16).padStart(24, "0");
const [A, B, C] = [1, 2, 3].map(oid);
const CID = oid(50);
const MID = oid(60);
const HOUR = 3600 * 1000;

const { checkDeleteForEveryone } = require(path.join(root, "src/utils/messageRules.js"));

let message;
const writes = [];
const events = [];
const stub = (rel, exports) => {
  const file = path.join(root, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub("src/models/Conversation.js", {
  findOne: (q) => ({
    select: async () =>
      q._id === CID && [A, B].includes(String(q.participants)) ? { participants: [A, B] } : null,
  }),
});
stub("src/models/Attachment.js", { deleteOne: async (q) => writes.push({ attachmentDeleted: q }) });
stub("src/models/Message.js", {
  findOne: (q) => ({
    select: async () => (q._id === MID && q.conversation === CID ? message : null),
  }),
  updateOne: async (f, u) => writes.push(u),
  find: () => ({}),
});
const io = {
  to(r) {
    this._t = (this._t || []).concat(r);
    return this;
  },
  emit(e, p) {
    events.push([e, this._t, p]);
    this._t = [];
  },
};
const { deleteMessage } = require(path.join(root, "src/controllers/messageController.js"));

const call = async (user, params, query) => {
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
  await deleteMessage({ user: { _id: user }, params, query, app: { get: () => io } }, res);
  return out;
};
const fresh = (over = {}) => {
  message = { _id: MID, sender: A, createdAt: new Date(Date.now() - HOUR), deletedAt: null, ...over };
  writes.length = 0;
  events.length = 0;
};
const P = { id: CID, messageId: MID };

test("rules: only the sender, only within 48 hours", () => {
  const now = Date.now();
  assert.equal(checkDeleteForEveryone({ sender: A, createdAt: new Date(now - HOUR) }, A, now).ok, true);
  assert.equal(checkDeleteForEveryone({ sender: A, createdAt: new Date(now - HOUR) }, B, now).ok, false);
  assert.equal(checkDeleteForEveryone({ sender: A, createdAt: new Date(now - 49 * HOUR) }, A, now).ok, false);
  assert.equal(checkDeleteForEveryone({ sender: A, createdAt: "garbage" }, A, now).ok, false);
});

test("bad scope or ids are rejected", async () => {
  fresh();
  assert.equal((await call(A, P, {})).c, 400);
  assert.equal((await call(A, P, { scope: { $ne: 1 } })).c, 400);
  assert.equal((await call(A, { id: "x", messageId: MID }, { scope: "me" })).c, 400);
  assert.equal(writes.length, 0);
});

test("outsiders get 404 and a message of another chat is not reachable", async () => {
  fresh();
  assert.equal((await call(C, P, { scope: "me" })).c, 404);
  assert.equal((await call(A, { id: CID, messageId: oid(61) }, { scope: "me" })).c, 404);
  assert.equal(writes.length, 0);
});

test("delete for me: any member, only their own screen is told", async () => {
  fresh();
  const r = await call(B, P, { scope: "me" });
  assert.equal(r.c, 200);
  assert.ok(writes[0].$addToSet.deletedFor);
  assert.deepEqual(events.map((e) => [e[0], e[1]]), [["message_removed", ["user:" + B]]]);
});

test("delete for everyone: sender only, erases the text, tells everyone", async () => {
  fresh();
  assert.equal((await call(B, P, { scope: "everyone" })).c, 403);
  assert.equal(writes.length, 0);
  const r = await call(A, P, { scope: "everyone" });
  assert.equal(r.c, 200);
  assert.equal(writes[0].$set.text, "");
  assert.ok(writes[0].$set.deletedAt instanceof Date);
  assert.deepEqual(events[0][1].sort(), ["user:" + A, "user:" + B].sort());
  assert.equal(events[0][0], "message_deleted");
});

test("delete for everyone is refused after 48 hours and repeats are harmless", async () => {
  fresh({ createdAt: new Date(Date.now() - 50 * HOUR) });
  assert.equal((await call(A, P, { scope: "everyone" })).c, 403);
  fresh({ deletedAt: new Date() });
  assert.equal((await call(A, P, { scope: "everyone" })).c, 200);
  assert.equal(writes.length, 0); // nothing written twice
});
