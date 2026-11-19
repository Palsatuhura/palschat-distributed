/**
 * Pure rules for group membership and admins. No database, no sockets, so
 * every rule can be tested on its own. All ids are handled as strings.
 *
 * A group is { participants: [id...], admins: [id...] }.
 *
 * Groups created before admins existed have an empty admins list. For those,
 * the first participant (the person who created the group, because creation
 * puts the creator first) counts as the admin.
 */
const { MAX_GROUP_OTHER_MEMBERS } = require("./constants");

const MAX_GROUP_MEMBERS = MAX_GROUP_OTHER_MEMBERS + 1;

const strings = (list) => (list || []).map((id) => String(id).toLowerCase());

/** Current admins (only people who are still members). */
const adminIdsOf = (participants, admins) => {
  const members = strings(participants);
  const real = strings(admins).filter((id) => members.includes(id));
  if (real.length > 0) return [...new Set(real)];
  return members.length > 0 ? [members[0]] : [];
};

const isGroupAdmin = (group, userId) =>
  adminIdsOf(group.participants, group.admins).includes(String(userId).toLowerCase());

const isMember = (group, userId) =>
  strings(group.participants).includes(String(userId).toLowerCase());

/** Add people. Existing members are ignored. */
const addMembers = (group, newIds, max = MAX_GROUP_MEMBERS) => {
  const members = strings(group.participants);
  const admins = adminIdsOf(group.participants, group.admins);
  const toAdd = [...new Set(strings(newIds))].filter((id) => !members.includes(id));

  if (toAdd.length === 0) return { error: "Everyone selected is already in the group" };
  if (members.length + toAdd.length > max) {
    return { error: `A group can have at most ${max} members` };
  }
  return { participants: [...members, ...toAdd], admins, added: toAdd };
};

/**
 * Remove a member (or let them leave). If that removes the last admin, the
 * longest-standing remaining member becomes admin, so a group is never left
 * without one.
 */
const removeMember = (group, targetId) => {
  const target = String(targetId).toLowerCase();
  const members = strings(group.participants);
  if (!members.includes(target)) return { error: "That person is not in the group" };

  const participants = members.filter((id) => id !== target);
  let admins = adminIdsOf(group.participants, group.admins).filter((id) => id !== target);
  if (admins.length === 0 && participants.length > 0) admins = [participants[0]];

  return { participants, admins };
};

const promote = (group, targetId) => {
  const target = String(targetId).toLowerCase();
  if (!isMember(group, target)) return { error: "That person is not in the group" };
  const admins = adminIdsOf(group.participants, group.admins);
  if (admins.includes(target)) return { error: "That person is already an admin" };
  return { participants: strings(group.participants), admins: [...admins, target] };
};

const demote = (group, targetId) => {
  const target = String(targetId).toLowerCase();
  const admins = adminIdsOf(group.participants, group.admins);
  if (!admins.includes(target)) return { error: "That person is not an admin" };
  if (admins.length === 1) {
    return { error: "A group needs at least one admin. Make someone else an admin first." };
  }
  return {
    participants: strings(group.participants),
    admins: admins.filter((id) => id !== target),
  };
};

module.exports = {
  MAX_GROUP_MEMBERS,
  adminIdsOf,
  isGroupAdmin,
  isMember,
  addMembers,
  removeMember,
  promote,
  demote,
};
