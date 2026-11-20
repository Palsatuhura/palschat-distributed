/**
 * Pure helpers for the per-person state of a conversation: "clear chat",
 * "delete chat", pin, mute and archive. No database, no sockets, so they can
 * be tested on their own.
 *
 * A conversation here is a plain object with:
 *   clearedAt: [{ user, at }]   messages up to `at` are hidden for `user`
 *   hiddenFor: [userId]         chat removed from these people's lists
 *   pinnedBy / mutedBy / archivedBy: [userId]
 */

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const has = (list, userId) => (list || []).some((id) => same(id, userId));

const PRIVATE_FIELDS = ["clearedAt", "hiddenFor", "pinnedBy", "mutedBy", "archivedBy"];

const plain = (c) => (c && typeof c.toObject === "function" ? c.toObject() : { ...c });

/** When this person last cleared the chat, as a Date, or null. */
const clearedAtFor = (conversation, userId) => {
  const entry = (conversation?.clearedAt || []).find((c) => same(c.user, userId));
  if (!entry) return null;
  const at = new Date(entry.at);
  return Number.isNaN(at.getTime()) ? null : at;
};

const isHiddenFor = (conversation, userId) => has(conversation?.hiddenFor, userId);

/** The conversation without anybody's private state (safe to broadcast). */
const stripPrivate = (conversation) => {
  const out = plain(conversation);
  for (const key of PRIVATE_FIELDS) delete out[key];
  return out;
};

/**
 * The conversation as ONE person should see it:
 *   - other people's private state is removed;
 *   - their own pin / mute / archive show as plain true/false flags;
 *   - a last-message preview that this person already cleared is dropped.
 */
const viewFor = (conversation, userId) => {
  const source = plain(conversation);
  const rest = stripPrivate(source);
  rest.pinned = has(source.pinnedBy, userId);
  rest.muted = has(source.mutedBy, userId);
  rest.archived = has(source.archivedBy, userId);

  const cleared = clearedAtFor(source, userId);
  if (cleared && rest.lastMessage && rest.lastMessage.createdAt) {
    if (new Date(rest.lastMessage.createdAt).getTime() <= cleared.getTime()) {
      rest.lastMessage = null;
    }
  }
  return rest;
};

module.exports = { clearedAtFor, isHiddenFor, stripPrivate, viewFor };
