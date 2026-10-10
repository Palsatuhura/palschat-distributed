const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

/**
 * GET /api/conversations
 * Returns all conversations for the currently logged-in user,
 * sorted by most recently updated (latest message first).
 * Populates participant info and last message preview.
 */
const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: { $in: [req.user._id] },
    })
      .populate("participants", "-password")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "name avatar" },
      })
      .sort({ updatedAt: -1 });

    res.status(200).json(conversations);
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({ message: "Server error fetching conversations" });
  }
};

/**
 * POST /api/conversations
 * Creates or retrieves an existing conversation.
 *
 * For 1-on-1 DM:
 *   body: { participantId: "<userId>" }
 *   Finds an existing DM between the two users, or creates one.
 *
 * For group chat:
 *   body: { participantIds: ["<userId>", ...], groupName: "My Group", isGroup: true }
 *   Always creates a new group conversation.
 */
const createOrGetConversation = async (req, res) => {
  try {
    const { participantId, participantIds, isGroup, groupName } = req.body;

    // --- Group chat creation ---
    if (isGroup) {
      if (!participantIds || participantIds.length < 2) {
        return res.status(400).json({ message: "Group needs at least 2 other participants" });
      }
      if (!groupName || !groupName.trim()) {
        return res.status(400).json({ message: "Group name is required" });
      }

      const allParticipants = [req.user._id, ...participantIds];
      const groupConversation = await Conversation.create({
        participants: allParticipants,
        isGroup: true,
        groupName: groupName.trim(),
      });

      const populated = await groupConversation.populate("participants", "-password");
      return res.status(201).json(populated);
    }

    // --- 1-on-1 DM creation ---
    if (!participantId) {
      return res.status(400).json({ message: "participantId is required" });
    }

    // Check if a 1-on-1 conversation already exists between these two users
    const existingConversation = await Conversation.findOne({
      isGroup: false,
      participants: { $all: [req.user._id, participantId], $size: 2 },
    })
      .populate("participants", "-password")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "name avatar" },
      });

    if (existingConversation) {
      return res.status(200).json(existingConversation);
    }

    // Create new DM
    const newConversation = await Conversation.create({
      participants: [req.user._id, participantId],
      isGroup: false,
    });

    const populated = await newConversation.populate("participants", "-password");
    return res.status(201).json(populated);
  } catch (error) {
    console.error("Create/get conversation error:", error);
    res.status(500).json({ message: "Server error creating conversation" });
  }
};

module.exports = { getConversations, createOrGetConversation };
