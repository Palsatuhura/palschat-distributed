/**
 * Phase 3 unit tests: pagination helpers, DM key, indexes, and the message
 * history controller (with the database replaced by small fakes).
 *
 *   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseLimit,
  olderThanFilter,
} = require("../src/utils/pagination");
const { dmKeyFor } = require("../src/utils/validators");

const oid = (n) => n.toString(16).padStart(24, "0");

// ── parseLimit ───────────────────────────────────────────────────────────

test("parseLimit defaults when missing or not a positive whole number", () => {
  for (const bad of [undefined, null, "", "abc", "0", "-5", NaN, {}, [], { $gt: 1 }]) {
    assert.equal(parseLimit(bad), DEFAULT_PAGE_SIZE, String(JSON.stringify(bad)));
  }
});

test("parseLimit accepts 1..max and clamps anything larger", () => {
  assert.equal(parseLimit("1"), 1);
  assert.equal(parseLimit("25"), 25);
  assert.equal(parseLimit(String(MAX_PAGE_SIZE)), MAX_PAGE_SIZE);
  assert.equal(parseLimit("100000"), MAX_PAGE_SIZE);
});

// ── olderThanFilter ──────────────────────────────────────────────────────

test("olderThanFilter matches older timestamps, and ties broken by _id", () => {
  const cursor = { _id: oid(5), createdAt: new Date("2026-01-01T00:00:00Z") };
  assert.deepEqual(olderThanFilter(cursor), {
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
    ],
  });
});

// ── dmKeyFor ─────────────────────────────────────────────────────────────

test("dmKeyFor is the same for (A,B) and (B,A), and ignores letter case", () => {
  const a = "AAAAAAAAAAAAAAAAAAAAAAAA";
  const b = oid(2);
  assert.equal(dmKeyFor(a, b), dmKeyFor(b, a));
  assert.equal(dmKeyFor(a, b), dmKeyFor(a.toLowerCase(), b));
});

test("dmKeyFor differs for different pairs and accepts ObjectId-like values", () => {
  assert.notEqual(dmKeyFor(oid(1), oid(2)), dmKeyFor(oid(1), oid(3)));
  assert.equal(dmKeyFor({ toString: () => oid(1) }, oid(2)), dmKeyFor(oid(1), oid(2)));
});

// ── indexes ──────────────────────────────────────────────────────────────

test("Message and Conversation declare the indexes the queries rely on", () => {
  const Message = require("../src/models/Message");
  const Conversation = require("../src/models/Conversation");

  const messageIndexes = Message.schema.indexes().map(([fields]) => fields);
  assert.ok(
    messageIndexes.some(
      (f) => f.conversation === 1 && f.createdAt === -1 && f._id === -1
    ),
    "Message {conversation, createdAt, _id}"
  );

  const conversationIndexes = Conversation.schema.indexes();
  assert.ok(
    conversationIndexes.some(([f]) => f.participants === 1 && f.updatedAt === -1),
    "Conversation {participants, updatedAt}"
  );
  assert.ok(
    conversationIndexes.some(([f, o]) => f.dmKey === 1 && o.unique === true),
    "Conversation dmKey is unique"
  );
});

// ── getMessages controller (fake database) ───────────────────────────────

const CONV = oid(100);
const ME = oid(1);

function loadController(fakes) {
  const originalLoad = Module._load;

  Module._load = function (request, ...rest) {
    if (request.endsWith("models/Message")) return fakes.Message;
    if (request.endsWith("models/Conversation")) return fakes.Conversation;
    return originalLoad.call(this, request, ...rest);
  };

  const path = require.resolve("../src/controllers/messageController");
  delete require.cache[path];

  try {
    return require(path).getMessages;
  } finally {
    Module._load = originalLoad;
  }
}

function makeRes() {
  return {
    code: 200,
    body: undefined,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function makeFakes({ stored = [], cursorFound = true } = {}) {
  const calls = { find: null, sort: null, limit: null, updateMany: 0 };

  const Message = {
    find(filter) {
      calls.find = filter;
      const chain = {
        populate: () => chain,
        sort(s) { calls.sort = s; return chain; },
        limit(n) { calls.limit = n; return Promise.resolve(stored.slice(0, n)); },
      };
      return chain;
    },
    findOne: () => ({
      select: async () => (cursorFound ? { _id: oid(50), createdAt: new Date(1000) } : null),
    }),
    updateMany: async () => { calls.updateMany += 1; return {}; },
  };

  const Conversation = {
    findById: async () => ({ participants: [ME] }),
  };

  return { Message, Conversation, calls };
}

const request = (query) => ({ params: { id: CONV }, query, user: { _id: ME } });

test("getMessages asks for the NEWEST messages and returns them oldest-first", async () => {
  // The database returns newest-first (sorted by us), so ids go 9,8,7.
  const fakes = makeFakes({ stored: [{ _id: oid(9) }, { _id: oid(8) }, { _id: oid(7) }] });
  const res = makeRes();

  await loadController(fakes)(request({ limit: "3" }), res);

  assert.deepEqual(fakes.calls.sort, { createdAt: -1, _id: -1 });
  assert.equal(fakes.calls.limit, 3);
  assert.deepEqual(res.body.map((m) => m._id), [oid(7), oid(8), oid(9)]);
  assert.equal(fakes.calls.updateMany, 1, "first page marks messages as read");
});

test("getMessages clamps the page size and ignores junk limits", async () => {
  let fakes = makeFakes();
  await loadController(fakes)(request({ limit: "999999" }), makeRes());
  assert.equal(fakes.calls.limit, MAX_PAGE_SIZE);

  fakes = makeFakes();
  await loadController(fakes)(request({ limit: { $gt: "" } }), makeRes());
  assert.equal(fakes.calls.limit, DEFAULT_PAGE_SIZE);

  fakes = makeFakes();
  await loadController(fakes)(request({}), makeRes());
  assert.equal(fakes.calls.limit, DEFAULT_PAGE_SIZE);
});

test("getMessages with ?before filters older messages and skips the read update", async () => {
  const fakes = makeFakes();
  const res = makeRes();

  await loadController(fakes)(request({ before: oid(50) }), res);

  assert.equal(res.code, 200);
  assert.equal(fakes.calls.find.conversation, CONV);
  assert.ok(Array.isArray(fakes.calls.find.$or), "cursor filter applied");
  assert.equal(fakes.calls.updateMany, 0);
});

test("getMessages rejects a malformed or foreign ?before cursor", async () => {
  let res = makeRes();
  await loadController(makeFakes())(request({ before: "nope" }), res);
  assert.equal(res.code, 400);

  res = makeRes();
  await loadController(makeFakes())(request({ before: { $ne: null } }), res);
  assert.equal(res.code, 400);

  res = makeRes();
  await loadController(makeFakes({ cursorFound: false }))(request({ before: oid(50) }), res);
  assert.equal(res.code, 404);
});

test("getMessages still refuses non-participants", async () => {
  const fakes = makeFakes();
  fakes.Conversation.findById = async () => ({ participants: [oid(77)] });
  const res = makeRes();

  await loadController(fakes)(request({}), res);

  assert.equal(res.code, 403);
  assert.equal(fakes.calls.find, null);
});
