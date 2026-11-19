/**
 * Who is an admin of a group. Mirrors the server rule (backend utils/groups.js):
 * admins who are no longer members do not count, and a group made before
 * admins existed (empty list) treats its first member, the creator, as admin.
 * Ids are compared as lower-case strings.
 */
const lower = (id) => String(id).toLowerCase();

export const memberIds = (conversation) =>
  (conversation?.participants || []).map((p) => lower(p?._id ?? p));

export const adminIdsOf = (conversation) => {
  const members = memberIds(conversation);
  const real = (conversation?.admins || []).map((a) => lower(a?._id ?? a)).filter((id) => members.includes(id));
  if (real.length > 0) return [...new Set(real)];
  return members.length > 0 ? [members[0]] : [];
};

export const isAdmin = (conversation, userId) =>
  userId ? adminIdsOf(conversation).includes(lower(userId)) : false;
