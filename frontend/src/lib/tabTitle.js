/** Unread messages in chats that are not muted. */
export const unreadTotal = (conversations = [], unreadCounts = {}) =>
  conversations.reduce((sum, c) => sum + (c.muted ? 0 : Number(unreadCounts[c._id]) || 0), 0);

/** "(3) PalsChat" when something is unread, "PalsChat" otherwise. */
export const tabTitle = (count) => {
  const n = Number(count) || 0;
  return n > 0 ? `(${n > 99 ? "99+" : n}) PalsChat` : "PalsChat";
};
