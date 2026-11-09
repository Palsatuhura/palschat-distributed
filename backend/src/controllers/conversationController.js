const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const {
  isValidObjectId,
  normalizeParticipantIds,
} = require("../utils/validators");
const {
  PUBLIC_USER_FIELDS,
  MAX_GROUP_NAME_LENGTH,
} = require("../utils/constants");

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
      .populate("participants", PUBLIC_USER_FIELDS)
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
    // Strict comparison: a string such as "false" must not count as true.
    if (isGroup === true) {
      // Validate, de-duplicate and cap the member list (self is removed here
      // and re-added below, so a client cannot list itself twice).
      const { ids: otherMemberIds, error: idsError } = normalizeParticipantIds(
        participantIds,
        req.user._id
      );
      if (idsError) {
        return res.status(400).json({ message: idsError });
      }
      if (otherMemberIds.length < 2) {
        return res.status(400).json({ message: "Group needs at least 2 other participants" });
      }

      if (typeof groupName !== "string" || !groupName.trim()) {
        return res.status(400).json({ message: "Group name is required" });
      }
      if (groupName.trim().length > MAX_GROUP_NAME_LENGTH) {
        return res.status(400).json({
          message: `Group name cannot exceed ${MAX_GROUP_NAME_LENGTH} characters`,
        });
      }

      // Every listed member must be a real user.
      const existingUsers = await User.countDocuments({ _id: { $in: otherMemberIds } });
      if (existingUsers !== otherMemberIds.length) {
        return res.status(400).json({ message: "One or more participants do not exist" });
      }

      const allParticipants = [req.user._id, ...otherMemberIds];
      const groupConversation = await Conversation.create({
        participants: allParticipants,
        isGroup: true,
        groupName: groupName.trim(),
      });

      const populated = await groupConversation.populate("participants", PUBLIC_USER_FIELDS);
      return res.status(201).json(populated);
    }

    // --- 1-on-1 DM creation ---
    if (!participantId) {
      return res.status(400).json({ message: "participantId is required" });
    }
    if (!isValidObjectId(participantId)) {
      return res.status(400).json({ message: "participantId must be a valid user ID" });
    }
    if (participantId.toLowerCase() === req.user._id.toString()) {
      return res.status(400).json({ message: "You cannot start a conversation with yourself" });
    }
    if (!(await User.exists({ _id: participantId }))) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if a 1-on-1 conversation already exists between these two users
    const existingConversation = await Conversation.findOne({
      isGroup: false,
      participants: { $all: [req.user._id, participantId], $size: 2 },
    })
      .populate("participants", PUBLIC_USER_FIELDS)
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

    const populated = await newConversation.populate("participants", PUBLIC_USER_FIELDS);
    return res.status(201).json(populated);
  } catch (error) {
    console.error("Create/get conversation error:", error);
    res.status(500).json({ message: "Server error creating conversation" });
  }
};

module.exports = { getConversations, createOrGetConversation };
