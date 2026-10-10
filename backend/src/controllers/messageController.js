const Message = require("../models/Message");
const Conversation = require("../models/Conversation");

/**
 * GET /api/conversations/:id/messages
 * Fetches the message history for a given conversation.
 * - Verifies the requesting user is a participant
 * - Marks all messages as read by the current user
 * - Returns messages sorted oldest-first (for chat display)
 * - Supports pagination via ?page=1&limit=50
 */
const getMessages = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Verify conversation exists and user is a participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === req.user._id.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({ message: "You are not a participant of this conversation" });
    }

    // Fetch messages with sender details
    const messages = await Message.find({ conversation: conversationId })
      .populate("sender", "name avatar")
      .sort({ createdAt: 1 }) // oldest first for chat rendering
      .skip(skip)
      .limit(limit);

    // Mark unread messages as read (for read receipts)
    await Message.updateMany(
      {
        conversation: conversationId,
        readBy: { $ne: req.user._id },
        sender: { $ne: req.user._id },
      },
      { $addToSet: { readBy: req.user._id } }
    );

    res.status(200).json(messages);
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ message: "Server error fetching messages" });
  }
};

module.exports = { getMessages };
