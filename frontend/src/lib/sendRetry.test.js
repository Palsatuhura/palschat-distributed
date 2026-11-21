import test from "node:test";
import assert from "node:assert/strict";
import { attemptFor, makeClientId, shouldRetry, MAX_SEND_ATTEMPTS } from "./sendRetry.js";

const parts = { conversationId: "c1", text: "hi", attachmentId: null, replyTo: null };

test("client ids are unique and fit the server's rule", () => {
  const a = makeClientId();
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(a, makeClientId());
});

test("a retry of the same message keeps its id; any change gives a new one", () => {
  const first = attemptFor(null, parts);
  assert.equal(attemptFor(first, { ...parts }).clientId, first.clientId);
  assert.notEqual(attemptFor(first, { ...parts, text: "hi!" }).clientId, first.clientId);
  assert.notEqual(attemptFor(first, { ...parts, conversationId: "c2" }).clientId, first.clientId);
  assert.notEqual(attemptFor(first, { ...parts, attachmentId: "a1" }).clientId, first.clientId);
  assert.notEqual(attemptFor(first, { ...parts, replyTo: "m1" }).clientId, first.clientId);
});

test("automatic retries stop after the limit", () => {
  assert.equal(shouldRetry(1), true);
  assert.equal(shouldRetry(MAX_SEND_ATTEMPTS - 1), true);
  assert.equal(shouldRetry(MAX_SEND_ATTEMPTS), false);
});
