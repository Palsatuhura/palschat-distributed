/**
 * Unit tests for the group rules (src/utils/groups.js) and the group
 * validators. Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const groups = require("../src/utils/groups");
const {
  validateGroupName,
  validateGroupDescription,
} = require("../src/utils/validators");

const oid = (n) => n.toString(16).padStart(24, "0");
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map(oid);

test("adminIdsOf: stored admins are used; legacy groups fall back to the first member", () => {
  assert.deepEqual(groups.adminIdsOf([A, B, C], [B]), [B]);
  assert.deepEqual(groups.adminIdsOf([A, B, C], []), [A]);
  assert.deepEqual(groups.adminIdsOf([A, B, C], undefined), [A]);
  // an admin who is no longer a member does not count
  assert.deepEqual(groups.adminIdsOf([A, B], [C]), [A]);
});

test("isGroupAdmin and isMember", () => {
  const g = { participants: [A, B, C], admins: [B] };
  assert.equal(groups.isGroupAdmin(g, B), true);
  assert.equal(groups.isGroupAdmin(g, A), false);
  assert.equal(groups.isMember(g, C), true);
  assert.equal(groups.isMember(g, D), false);
});

test("addMembers adds new people, ignores existing ones, keeps admins", () => {
  const g = { participants: [A, B], admins: [A] };
  const r = groups.addMembers(g, [B, C, C, D]);
  assert.deepEqual(r.participants, [A, B, C, D]);
  assert.deepEqual(r.added, [C, D]);
  assert.deepEqual(r.admins, [A]);
});

test("addMembers refuses when everyone is already in, or the group would be too big", () => {
  const g = { participants: [A, B], admins: [A] };
  assert.ok(groups.addMembers(g, [A, B]).error);
  assert.ok(groups.addMembers(g, [C, D], 3).error);
  assert.ok(!groups.addMembers(g, [C], 3).error);
});

test("removeMember removes a plain member and keeps the admins", () => {
  const g = { participants: [A, B, C], admins: [A] };
  const r = groups.removeMember(g, C);
  assert.deepEqual(r.participants, [A, B]);
  assert.deepEqual(r.admins, [A]);
});

test("removeMember: if the last admin leaves, the next member becomes admin", () => {
  const g = { participants: [A, B, C], admins: [A] };
  const r = groups.removeMember(g, A);
  assert.deepEqual(r.participants, [B, C]);
  assert.deepEqual(r.admins, [B]);
});

test("removeMember: other admins stay when one admin leaves", () => {
  const g = { participants: [A, B, C], admins: [A, C] };
  assert.deepEqual(groups.removeMember(g, A).admins, [C]);
});

test("removeMember: not a member is an error; the last person leaving empties the group", () => {
  assert.ok(groups.removeMember({ participants: [A], admins: [A] }, D).error);
  const r = groups.removeMember({ participants: [A], admins: [A] }, A);
  assert.deepEqual(r.participants, []);
  assert.deepEqual(r.admins, []);
});

test("promote and demote follow the rules", () => {
  const g = { participants: [A, B, C], admins: [A] };

  const up = groups.promote(g, B);
  assert.deepEqual(up.admins, [A, B]);

  assert.ok(groups.promote(g, A).error); // already admin
  assert.ok(groups.promote(g, D).error); // not a member

  // cannot remove the only admin
  assert.ok(groups.demote(g, A).error);
  // can once there are two
  const down = groups.demote({ participants: [A, B, C], admins: [A, B] }, A);
  assert.deepEqual(down.admins, [B]);
  // demoting someone who is not an admin is an error
  assert.ok(groups.demote({ participants: [A, B], admins: [A, B] }, E).error);
});

test("legacy group (no admins stored): the first member can be demoted only after another is promoted", () => {
  const g = { participants: [A, B], admins: [] };
  assert.ok(groups.demote(g, A).error);
  const up = groups.promote(g, B);
  assert.deepEqual(up.admins, [A, B]);
});

test("ids are compared case-insensitively", () => {
  const g = { participants: [A.toUpperCase(), B], admins: [A] };
  assert.equal(groups.isGroupAdmin(g, A), true);
  assert.ok(groups.removeMember(g, A).participants.includes(B));
});

test("validateGroupName and validateGroupDescription", () => {
  assert.deepEqual(validateGroupName("  Team  "), { groupName: "Team" });
  assert.ok(validateGroupName("   ").error);
  assert.ok(validateGroupName(5).error);
  assert.ok(validateGroupName("x".repeat(51)).error);
  assert.deepEqual(validateGroupDescription(""), { groupDescription: "" });
  assert.ok(validateGroupDescription("x".repeat(201)).error);
  assert.ok(validateGroupDescription({ $ne: 1 }).error);
});
