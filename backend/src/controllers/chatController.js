const Conversation = require("../models/Conversation");
const { isValidObjectId } = require("../utils/validators");

/**
 * Clear chat and delete chat. Both only change THIS person's view; the other
 * members keep everything.
 *
 *   POST   /api/conversations/:id/clear   hide the messages up to now
 *   DELETE /api/conversations/:id         clear + remove the chat from my list
 *                                         (it returns when a new message
 *                                         arrives; leaving a group is separate)
 *
 * The person always comes from the login token. Other devices of the same
 * person are told live so they stay in step.
 */

const room = (userId) => `user:${userId}`;

const findMine = async (conversationId, userId) => {
  if (!isValidObjectId(conversationId)) return null;
  return Conversation.findOne({ _id: conversationId, participants: userId }).select("_id");
};

const markCleared = async (conversationId, userId, at) => {
  // One entry per person: drop the old one, then add the new time.
  await Conversation.updateOne({ _id: conversationId }, { $pull: { clearedAt: { user: userId } } });
  await Conversation.updateOne({ _id: conversationId }, { $push: { clearedAt: { user: userId, at } } });
};

const tellMyDevices = (req, event, payload) => {
  try {
    req.app.get("io")?.to(room(req.user._id)).emit(event, payload);
  } catch {
    /* live update is best effort */
  }
};

const clearChat = async (req, res) => {
  try {
    const conversation = await findMine(req.params.id, req.user._id);
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });

    const at = new Date();
    await markCleared(conversation._id, req.user._id, at);

    const conversationId = String(conversation._id);
    tellMyDevices(req, "chat_cleared", { conversationId });
    res.status(200).json({ conversationId, clearedAt: at });
  } catch (error) {
    console.error("Clear chat error:", error);
    res.status(500).json({ message: "Server error clearing the chat" });
  }
};

const deleteChat = async (req, res) => {
  try {
    const conversation = await findMine(req.params.id, req.user._id);
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });

    await markCleared(conversation._id, req.user._id, new Date());
    await Conversation.updateOne(
      { _id: conversation._id },
      { $addToSet: { hiddenFor: req.user._id } }
    );

    const conversationId = String(conversation._id);
    tellMyDevices(req, "chat_deleted", { conversationId });
    res.status(200).json({ conversationId, deleted: true });
  } catch (error) {
    console.error("Delete chat error:", error);
    res.status(500).json({ message: "Server error deleting the chat" });
  }
};

module.exports = { clearChat, deleteChat };
