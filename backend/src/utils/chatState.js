/**
 * Pure helpers for the per-person state of a conversation: "clear chat" and
 * "delete chat". No database, no sockets, so they can be tested on their own.
 *
 * A conversation here is a plain object with:
 *   clearedAt: [{ user, at }]   messages up to `at` are hidden for `user`
 *   hiddenFor: [userId]         chat removed from these people's lists
 */

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** When this person last cleared the chat, as a Date, or null. */
const clearedAtFor = (conversation, userId) => {
  const entry = (conversation?.clearedAt || []).find((c) => same(c.user, userId));
  if (!entry) return null;
  const at = new Date(entry.at);
  return Number.isNaN(at.getTime()) ? null : at;
};

const isHiddenFor = (conversation, userId) =>
  (conversation?.hiddenFor || []).some((id) => same(id, userId));

/**
 * The conversation as ONE person should see it:
 *   - other people's private state (clearedAt, hiddenFor) is removed;
 *   - a last-message preview that this person already cleared is dropped.
 */
const viewFor = (conversation, userId) => {
  const { clearedAt, hiddenFor, ...rest } = conversation;
  const cleared = clearedAtFor(conversation, userId);

  if (cleared && rest.lastMessage && rest.lastMessage.createdAt) {
    if (new Date(rest.lastMessage.createdAt).getTime() <= cleared.getTime()) {
      rest.lastMessage = null;
    }
  }
  return rest;
};

module.exports = { clearedAtFor, isHiddenFor, viewFor };
