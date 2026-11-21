/**
 * Retried sends are not saved twice: the client id validator, the lookup of
 * an already saved message, and the database rule behind it.
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateClientId, findSavedMessage } = require("../src/utils/clientId");

test("validateClientId: optional, but when present a short safe string", () => {
  assert.deepEqual(validateClientId(undefined), { clientId: null });
  assert.deepEqual(validateClientId(null), { clientId: null });
  assert.deepEqual(validateClientId("3f2b8c1e-aaaa-bbbb"), { clientId: "3f2b8c1e-aaaa-bbbb" });
  for (const bad of ["", "short", "x".repeat(65), "has space 12345", "semi;colon-123", 12345678, { $ne: "" }, ["abcdefgh"], true]) {
    assert.ok(validateClientId(bad).error, `should reject ${JSON.stringify(bad)}`);
  }
});

test("findSavedMessage returns the earlier message, populated, and nothing without a label", async () => {
  const populated = [];
  const saved = {
    _id: "m1",
    replyTo: "m0",
    populate: async (arg) => populated.push(typeof arg === "string" ? arg : arg.path),
  };
  const asked = [];
  const Message = { findOne: async (q) => (asked.push(q), saved) };

  assert.equal(await findSavedMessage(Message, "u1", null), null);
  assert.equal(asked.length, 0, "no label: no database query");

  assert.equal(await findSavedMessage(Message, "u1", "label-12345"), saved);
  assert.deepEqual(asked[0], { sender: "u1", clientId: "label-12345" });
  assert.deepEqual(populated, ["sender", "replyTo"]);

  assert.equal(await findSavedMessage({ findOne: async () => null }, "u1", "label-12345"), null);
});

test("Message has a unique (sender, clientId) index that ignores messages without a label", () => {
  const Message = require("../src/models/Message");
  const found = Message.schema
    .indexes()
    .find(([f]) => f.sender === 1 && f.clientId === 1);
  assert.ok(found, "index exists");
  assert.equal(found[1].unique, true);
  assert.deepEqual(found[1].partialFilterExpression, { clientId: { $type: "string" } });
});
