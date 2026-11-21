/**
 * A "client id" is a random label the browser attaches to each message it
 * sends. If the connection drops and the browser sends the same message
 * again, the server recognises the label and returns the message it already
 * saved instead of saving a second copy.
 */

/** Returns { clientId } (null when absent) or { error }. */
const validateClientId = (value) => {
  if (value === undefined || value === null) return { clientId: null };
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) {
    return { error: "Invalid message data" };
  }
  return { clientId: value };
};



/**
 * The message this sender already saved under this label, populated the same
 * way as a freshly sent one, or null. `Message` is passed in so the function
 * can be tested without a database.
 */
const findSavedMessage = async (Message, senderId, clientId) => {
  if (!clientId) return null;
  const existing = await Message.findOne({ sender: senderId, clientId });
  if (!existing) return null;
  await existing.populate("sender", "name");
  if (existing.replyTo) {
    await existing.populate({
      path: "replyTo",
      select: "text sender deletedAt attachment",
      populate: { path: "sender", select: "name" },
    });
  }
  return existing;
};
module.exports = { validateClientId, findSavedMessage };
