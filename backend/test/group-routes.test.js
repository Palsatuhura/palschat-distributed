/**
 * Group endpoint rules, tested through the real controller with stand-in
 * models (no database). Checks who may do what: admins vs members vs
 * outsiders, leaving, the "always one admin" rule, and the live notices.
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "..");
const oid = (n) => n.toString(16).padStart(24, "0");
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map(oid);
const GID = oid(99);

let current;
const log = [];
const events = [];

const mkGroup = (participants, admins) => ({
  _id: GID,
  isGroup: true,
  participants: [...participants],
  admins: [...admins],
  groupName: "G",
  async save() {
    log.push("save");
  },
});

const Conversation = {
  findOne: async (q) => {
    if (q._id !== GID || !current) return null;
    return current.participants.map(String).includes(String(q.participants)) ? current : null;
  },
  findById: () => ({
    populate() {
      return this;
    },
    then(resolve) {
      resolve({ _id: GID, participants: current.participants, admins: current.admins });
    },
  }),
  deleteOne: async () => log.push("deleteConv"),
};
const Message = { deleteMany: async () => log.push("deleteMsgs") };
const User = { countDocuments: async (q) => q._id.$in.length };

const stub = (rel, exports) => {
  const file = path.join(root, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub("src/models/Conversation.js", Conversation);
stub("src/models/Message.js", Message);
stub("src/models/User.js", User);
const g = require(path.join(root, "src/controllers/groupController.js"));

const io = {
  to(room) {
    this._t = (this._t || []).concat(room);
    return this;
  },
  emit(event) {
    events.push([event, this._t]);
    this._t = [];
  },
  in(room) {
    return { socketsLeave: (x) => events.push(["leave", room, x]) };
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

const reset = (participants = [A, B, C], admins = [A]) => {
  current = mkGroup(participants, admins);
  events.length = 0;
  log.length = 0;
};

test("only admins can add people; outsiders cannot even see the group", async () => {
  reset();
  assert.equal((await call(g.addGroupMembers, B, { id: GID }, { userIds: [D] })).c, 403);
  assert.equal((await call(g.addGroupMembers, E, { id: GID }, { userIds: [D] })).c, 404);
  assert.equal((await call(g.addGroupMembers, A, { id: GID }, { userIds: [D] })).c, 200);
  assert.equal(current.participants.length, 4);
});

test("only admins can remove others; a removed person is told and leaves the room", async () => {
  reset();
  assert.equal((await call(g.removeGroupMember, B, { id: GID, userId: C }, {})).c, 403);
  assert.equal((await call(g.removeGroupMember, A, { id: GID, userId: C }, {})).c, 200);
  assert.ok(events.some((e) => e[0] === "conversation_removed" && e[1].includes("user:" + C)));
  assert.ok(events.some((e) => e[0] === "leave"));
});

test("anyone can leave; the last admin leaving promotes someone", async () => {
  reset();
  const left = await call(g.removeGroupMember, B, { id: GID, userId: B }, {});
  assert.equal(left.c, 200);
  assert.equal(left.j.removed, true);

  reset();
  assert.equal((await call(g.removeGroupMember, A, { id: GID, userId: A }, {})).c, 200);
  assert.equal(current.admins.length, 1);
  assert.notEqual(current.admins[0], A);
});

test("the last person leaving closes the group", async () => {
  reset([A], [A]);
  assert.equal((await call(g.removeGroupMember, A, { id: GID, userId: A }, {})).c, 200);
  assert.ok(log.includes("deleteConv"));
});

test("admin changes: promote, demote, and always keep one admin", async () => {
  reset();
  assert.equal((await call(g.removeAdmin, A, { id: GID, userId: A }, {})).c, 400);
  assert.equal((await call(g.makeAdmin, B, { id: GID, userId: C }, {})).c, 403);
  assert.equal((await call(g.makeAdmin, A, { id: GID, userId: D }, {})).c, 400);
  assert.equal((await call(g.makeAdmin, A, { id: GID, userId: B }, {})).c, 200);
  assert.equal(current.admins.length, 2);
  assert.equal((await call(g.removeAdmin, A, { id: GID, userId: A }, {})).c, 200);
  assert.equal(current.admins.length, 1);
});

test("editing the group: admins only, and the icon must be a real image", async () => {
  reset();
  assert.equal((await call(g.updateGroup, B, { id: GID }, { groupName: "X" })).c, 403);
  assert.equal(
    (await call(g.updateGroup, A, { id: GID }, { groupName: "N", groupAvatar: "https://x/y.png" })).c,
    400
  );
  assert.equal((await call(g.updateGroup, A, { id: GID }, { groupName: "New" })).c, 200);
  assert.equal(current.groupName, "New");
});

test("bad ids and operators are rejected", async () => {
  reset();
  assert.equal((await call(g.removeGroupMember, A, { id: GID, userId: "nope" }, {})).c, 400);
  assert.equal((await call(g.addGroupMembers, A, { id: GID }, { userIds: { $ne: null } })).c, 400);
});
