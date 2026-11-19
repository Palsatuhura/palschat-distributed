import test from "node:test";
import assert from "node:assert/strict";
import { adminIdsOf, isAdmin } from "./groups.js";

const conv = (ids, admins) => ({
  participants: ids.map((_id) => ({ _id })),
  admins,
});

test("admins are the listed admins who are still members", () => {
  const c = conv(["a", "b", "c"], ["b", "zzz"]);
  assert.deepEqual(adminIdsOf(c), ["b"]);
  assert.equal(isAdmin(c, "b"), true);
  assert.equal(isAdmin(c, "a"), false);
});

test("an old group with no admin list treats the first member as admin", () => {
  const c = conv(["a", "b"], []);
  assert.deepEqual(adminIdsOf(c), ["a"]);
  assert.equal(isAdmin(c, "a"), true);
  assert.equal(isAdmin({ participants: [] }, "a"), false);
});

test("ids compare case-insensitively and isAdmin handles a missing user", () => {
  const c = conv(["AB12"], ["ab12"]);
  assert.equal(isAdmin(c, "Ab12"), true);
  assert.equal(isAdmin(c, undefined), false);
});
