const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const { isValidObjectId } = require("../utils/validators");
const { parseLimit, olderThanFilter } = require("../utils/pagination");
const { clearedAtFor } = require("../utils/chatState");
const { checkDeleteForEveryone } = require("../utils/messageRules");

// The little quoted message shown above a reply.
const REPLY_POPULATE = {
  path: "replyTo",
  select: "text sender deletedAt",
  populate: { path: "sender", select: "name" },
};

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
    const newestFirst = await Message.find({
      conversation: conversationId,
      deletedFor: { $ne: req.user._id }, // "delete for me"
      ...notCleared,
      ...olderThan,
    })
      .populate("sender", "name")
      .populate(REPLY_POPULATE)
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

const roomOf = (userId) => `user:${userId}`;

/**
 * DELETE /api/conversations/:id/messages/:messageId?scope=me|everyone
 *   me        remove it from MY view only (any member)
 *   everyone  erase it for all members (only the sender, within 48 hours);
 *             a "This message was deleted" note stays in its place
 */
const deleteMessage = async (req, res) => {
  try {
    const { id: conversationId, messageId } = req.params;
    const scope = req.query.scope;

    if (scope !== "me" && scope !== "everyone") {
      return res.status(400).json({ message: "scope must be 'me' or 'everyone'" });
    }
    if (!isValidObjectId(conversationId) || !isValidObjectId(messageId)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user._id,
    }).select("participants");
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });

    // The message must belong to THIS conversation, so ids cannot be used to
    // reach other chats.
    const message = await Message.findOne({ _id: messageId, conversation: conversationId }).select(
      "sender createdAt deletedAt"
    );
    if (!message) return res.status(404).json({ message: "Message not found" });

    const io = req.app.get("io");

    if (scope === "me") {
      await Message.updateOne({ _id: message._id }, { $addToSet: { deletedFor: req.user._id } });
      try {
        io?.to(roomOf(req.user._id)).emit("message_removed", { conversationId, messageId });
      } catch {
        /* live update is best effort */
      }
      return res.status(200).json({ conversationId, messageId, scope });
    }

    const verdict = checkDeleteForEveryone(message, req.user._id);
    if (!verdict.ok) return res.status(verdict.status).json({ message: verdict.message });

    const deletedAt = message.deletedAt || new Date();
    if (!message.deletedAt) {
      await Message.updateOne({ _id: message._id }, { $set: { text: "", deletedAt } });
    }

    try {
      let target = io;
      for (const id of conversation.participants) target = target.to(roomOf(id));
      target.emit("message_deleted", { conversationId, messageId, deletedAt });
    } catch {
      /* live update is best effort */
    }
    res.status(200).json({ conversationId, messageId, scope, deletedAt });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({ message: "Server error deleting the message" });
  }
};

module.exports = { getMessages, deleteMessage, REPLY_POPULATE };
