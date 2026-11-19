const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const { isValidObjectId } = require("../utils/validators");
const { parseLimit, olderThanFilter } = require("../utils/pagination");
const { clearedAtFor } = require("../utils/chatState");

/**
 * GET /api/conversations/:id/messages
 * Fetches the message history for a given conversation.
 * - Verifies the requesting user is a participant
 * - Returns ONE PAGE of messages, oldest-first within the page (for display)
 * - The first page (no ?before) is the NEWEST messages of the conversation
 * - ?limit=50 (1..100) sets the page size
 * - ?before=<messageId> returns the page of messages older than that one
 * - Marks messages as read by the current user (first page only)
 *
 * The client knows it has reached the start of the conversation when a page
 * comes back with fewer than `limit` messages.
 */
const getMessages = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const limit = parseLimit(req.query.limit);
    const { before } = req.query;

    // A malformed id would otherwise throw a CastError and surface as a 500.
    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation id" });
    }

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

    // Optional cursor: only messages older than this one (which must belong
    // to THIS conversation, so ids cannot be used to probe other chats).
    let olderThan = {};
    if (before !== undefined) {
      if (!isValidObjectId(before)) {
        return res.status(400).json({ message: "Invalid 'before' message id" });
      }

      const cursor = await Message.findOne({ _id: before, conversation: conversationId }).select(
        "createdAt"
      );
      if (!cursor) {
        return res.status(404).json({ message: "Message not found in this conversation" });
      }

      olderThan = olderThanFilter(cursor);
    }

    // "Clear chat": this person never sees messages from before the time they
    // cleared it (other members still do).
    const clearedAt = clearedAtFor(conversation, req.user._id);
    const notCleared = clearedAt ? { createdAt: { $gt: clearedAt } } : {};

    // Newest first so that "limit" keeps the LATEST messages, then flip the
    // page to oldest-first for display.
    const newestFirst = await Message.find({ conversation: conversationId, ...notCleared, ...olderThan })
      .populate("sender", "name")
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit);

    const messages = newestFirst.reverse();

    // Mark unread messages as read (for read receipts). Loading an older page
    // cannot contain anything unread, so skip the extra write then.
    if (before === undefined) {
      await Message.updateMany(
        {
          conversation: conversationId,
          readBy: { $ne: req.user._id },
          sender: { $ne: req.user._id },
        },
        { $addToSet: { readBy: req.user._id } }
      );
    }

    res.status(200).json(messages);
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ message: "Server error fetching messages" });
  }
};

module.exports = { getMessages };
