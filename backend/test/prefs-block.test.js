/**
 * Pin / mute / archive and blocking, through the real controllers with
 * stand-in models. Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "..");
const oid = (n) => n.toString(16).padStart(24, "0");
const [A, B, C] = [1, 2, 3].map(oid);
const CID = oid(50);

const { viewFor, stripPrivate } = require(path.join(root, "src/utils/chatState.js"));

const writes = [];
const events = [];
let pinnedCount = 0;
let alreadyPinned = false;
let blockedList = [];
const stub = (rel, exports) => {
  const file = path.join(root, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub("src/models/Conversation.js", {
  findOne: (q) => ({
    select: async () =>
      q._id === CID && [A, B].includes(String(q.participants)) ? { _id: CID } : null,
  }),
  exists: async () => alreadyPinned,
  countDocuments: async () => pinnedCount,
  updateOne: async (f, u) => writes.push(u),
});
stub("src/models/User.js", {
  exists: async (q) => (q._id === C ? null : { _id: q._id }),
  updateOne: async (f, u) => {
    writes.push(u);
    if (u.$addToSet) blockedList.push(u.$addToSet.blocked);
    if (u.$pull) blockedList = blockedList.filter((x) => x !== u.$pull.blocked);
  },
  findById: () => ({ select: () => ({ lean: async () => ({ blocked: blockedList }) }) }),
});
const chat = require(path.join(root, "src/controllers/chatController.js"));
const block = require(path.join(root, "src/controllers/blockController.js"));

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
  writes.length = 0;
  events.length = 0;
  pinnedCount = 0;
  alreadyPinned = false;
  blockedList = [];
};

test("viewFor turns my pin/mute/archive into flags and hides everyone's lists", () => {
  const c = { pinnedBy: [A], mutedBy: [B], archivedBy: [], hiddenFor: [], clearedAt: [] };
  const mine = viewFor(c, A);
  assert.deepEqual([mine.pinned, mine.muted, mine.archived], [true, false, false]);
  const theirs = viewFor(c, B);
  assert.deepEqual([theirs.pinned, theirs.muted, theirs.archived], [false, true, false]);
  for (const k of ["pinnedBy", "mutedBy", "archivedBy", "hiddenFor", "clearedAt"]) {
    assert.equal(k in mine, false);
  }
  assert.equal("pinned" in stripPrivate(c), false); // broadcasts carry no flags
});

test("prefs: members only, booleans only, something to change", async () => {
  reset();
  assert.equal((await call(chat.setPrefs, C, { id: CID }, { muted: true })).c, 404);
  assert.equal((await call(chat.setPrefs, A, { id: CID }, { muted: "yes" })).c, 400);
  assert.equal((await call(chat.setPrefs, A, { id: CID }, {})).c, 400);
  assert.equal(writes.length, 0);
});

test("prefs: mute and unmute change only my own list and tell my devices", async () => {
  reset();
  assert.equal((await call(chat.setPrefs, A, { id: CID }, { muted: true })).c, 200);
  assert.equal(String(writes[0].$addToSet.mutedBy), A);
  assert.equal((await call(chat.setPrefs, A, { id: CID }, { muted: false })).c, 200);
  assert.equal(String(writes[1].$pull.mutedBy), A);
  assert.ok(events.every((e) => e[0] === "conversation_prefs" && e[1] === "user:" + A));
});

test("prefs: at most 3 pinned chats; archiving unpins", async () => {
  reset();
  pinnedCount = 3;
  assert.equal((await call(chat.setPrefs, A, { id: CID }, { pinned: true })).c, 400);
  alreadyPinned = true; // re-pinning one that is already pinned is fine
  assert.equal((await call(chat.setPrefs, A, { id: CID }, { pinned: true })).c, 200);
  reset();
  const r = await call(chat.setPrefs, A, { id: CID }, { archived: true });
  assert.equal(r.c, 200);
  assert.equal(r.j.pinned, false);
  assert.ok(writes[0].$addToSet.archivedBy && writes[0].$pull.pinnedBy);
});

test("block: cannot block yourself, bad ids, or missing people", async () => {
  reset();
  assert.equal((await call(block.blockUser, A, { id: A })).c, 400);
  assert.equal((await call(block.blockUser, A, { id: "nope" })).c, 400);
  assert.equal((await call(block.blockUser, A, { id: C })).c, 404);
  assert.equal(writes.length, 0);
});

test("block and unblock update my list and tell my other devices", async () => {
  reset();
  const b = await call(block.blockUser, A, { id: B });
  assert.deepEqual(b.j.blocked, [B]);
  assert.deepEqual(events[0], ["blocks_updated", "user:" + A, { blocked: [B] }]);
  const u = await call(block.unblockUser, A, { id: B });
  assert.deepEqual(u.j.blocked, []);
  const g = await call(block.getBlocked, A, {});
  assert.deepEqual(g.j.blocked, []);
});
