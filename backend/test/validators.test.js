/**
 * Unit tests for src/utils/validators.js
 *
 * Uses Node's built-in test runner (Node 18+), so no extra packages are
 * needed:   npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isValidObjectId,
  normalizeParticipantIds,
} = require("../src/utils/validators");
const { MAX_GROUP_OTHER_MEMBERS } = require("../src/utils/constants");

// Build a deterministic 24-char hex id from a number.
const oid = (n) => n.toString(16).padStart(24, "0");

const SELF = oid(1);

test("isValidObjectId accepts 24-char hex strings", () => {
  assert.equal(isValidObjectId("507f1f77bcf86cd799439011"), true);
  assert.equal(isValidObjectId("507F1F77BCF86CD799439011"), true);
});

test("isValidObjectId rejects everything else", () => {
  const bad = [
    undefined,
    null,
    "",
    "abc",
    "507f1f77bcf86cd79943901", // 23 chars
    "507f1f77bcf86cd7994390111", // 25 chars
    "507f1f77bcf86cd79943901g", // non-hex
    "123456789012", // 12-char string Mongoose would accept
    12345,
    {},
    [],
    ["507f1f77bcf86cd799439011"],
    { $ne: null }, // NoSQL operator injection
    { $gt: "" },
  ];

  for (const value of bad) {
    assert.equal(isValidObjectId(value), false, `should reject ${JSON.stringify(value)}`);
  }
});

test("normalizeParticipantIds rejects non-arrays", () => {
  for (const input of [undefined, null, "x", 5, {}, { 0: oid(2) }]) {
    const result = normalizeParticipantIds(input, SELF);
    assert.ok(result.error, `should reject ${JSON.stringify(input)}`);
    assert.equal(result.ids, undefined);
  }
});

test("normalizeParticipantIds rejects arrays containing invalid entries", () => {
  assert.ok(normalizeParticipantIds([oid(2), "nope"], SELF).error);
  assert.ok(normalizeParticipantIds([oid(2), { $ne: null }], SELF).error);
  assert.ok(normalizeParticipantIds([oid(2), 7], SELF).error);
});

test("normalizeParticipantIds removes duplicates and the requesting user", () => {
  const { ids, error } = normalizeParticipantIds(
    [oid(2), oid(3), oid(2), SELF, SELF.toUpperCase(), oid(3).toUpperCase()],
    SELF
  );

  assert.equal(error, undefined);
  assert.deepEqual(ids.sort(), [oid(2), oid(3)].sort());
});

test("normalizeParticipantIds accepts an ObjectId-like selfId", () => {
  // req.user._id is an ObjectId in real use; String() must handle it.
  const selfLike = { toString: () => SELF };
  const { ids } = normalizeParticipantIds([SELF, oid(2)], selfLike);
  assert.deepEqual(ids, [oid(2)]);
});

test("normalizeParticipantIds enforces the member cap", () => {
  const atLimit = Array.from({ length: MAX_GROUP_OTHER_MEMBERS }, (_, i) => oid(i + 10));
  assert.equal(normalizeParticipantIds(atLimit, SELF).ids.length, MAX_GROUP_OTHER_MEMBERS);

  const overLimit = Array.from({ length: MAX_GROUP_OTHER_MEMBERS + 1 }, (_, i) => oid(i + 10));
  assert.ok(normalizeParticipantIds(overLimit, SELF).error);
});

test("normalizeParticipantIds returns an empty list for an empty array", () => {
  assert.deepEqual(normalizeParticipantIds([], SELF), { ids: [] });
});
