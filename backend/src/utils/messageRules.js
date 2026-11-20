const { DELETE_FOR_EVERYONE_MS } = require("./constants");

/**
 * Pure rules for deleting messages (no database), so they can be tested.
 */

/**
 * May this person delete this message for everyone?
 * Returns { ok: true } or { ok: false, status, message }.
 *   - only the sender;
 *   - only within DELETE_FOR_EVERYONE_MS of sending.
 */
const checkDeleteForEveryone = (message, userId, now = Date.now()) => {
  if (String(message.sender) !== String(userId)) {
    return { ok: false, status: 403, message: "You can only delete your own messages for everyone" };
  }
  const age = now - new Date(message.createdAt).getTime();
  if (!(age <= DELETE_FOR_EVERYONE_MS)) {
    return {
      ok: false,
      status: 403,
      message: "This message is too old to delete for everyone. You can still delete it for yourself.",
    };
  }
  return { ok: true };
};

module.exports = { checkDeleteForEveryone };
