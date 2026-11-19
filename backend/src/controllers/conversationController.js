const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const {
  dmKeyFor,
  isValidObjectId,
  normalizeParticipantIds,
  validateAvatar,
  validateGroupName,
  validateGroupDescription,
} = require("../utils/validators");
const { PUBLIC_USER_FIELDS } = require("../utils/constants");

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
        populate: { path: "sender", select: "name" },
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
    const { participantId, participantIds, isGroup, groupName, groupAvatar, groupDescription } = req.body;

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

      const { groupName: cleanName, error: nameError } = validateGroupName(groupName);
      if (nameError) {
        return res.status(400).json({ message: nameError });
      }

      let cleanAvatar = "";
      if (groupAvatar !== undefined) {
        const { avatar, error: avatarError } = validateAvatar(groupAvatar);
        if (avatarError) return res.status(400).json({ message: avatarError });
        cleanAvatar = avatar;
      }

      let cleanDescription = "";
      if (groupDescription !== undefined) {
        const { groupDescription: d, error: descError } = validateGroupDescription(groupDescription);
        if (descError) return res.status(400).json({ message: descError });
        cleanDescription = d;
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
        groupName: cleanName,
        groupAvatar: cleanAvatar,
        groupDescription: cleanDescription,
        admins: [req.user._id], // the creator starts as the admin
      });

      const populated = await groupConversation.populate("participants", PUBLIC_USER_FIELDS);

      // Show the new group to the other members right away, without waiting
      // for the first message. Best effort: never fail the request.
      try {
        const io = req.app.get("io");
        if (io && otherMemberIds.length > 0) {
          let target = io;
          for (const id of otherMemberIds) target = target.to(`user:${id}`);
          target.emit("conversation_updated", populated);
        }
      } catch {
        /* ignore */
      }

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

    // Look up an existing 1-on-1 conversation between these two users.
    // (Also finds DMs created before dmKey existed.)
    const findExistingDm = () =>
      Conversation.findOne({
        isGroup: false,
        participants: { $all: [req.user._id, participantId], $size: 2 },
      })
        .populate("participants", PUBLIC_USER_FIELDS)
        .populate({
          path: "lastMessage",
          populate: { path: "sender", select: "name" },
        });

    const existingConversation = await findExistingDm();
    if (existingConversation) {
      return res.status(200).json(existingConversation);
    }

    // Create new DM. Two requests can get here at the same moment; the unique
    // index on dmKey lets exactly one of them win.
    try {
      const newConversation = await Conversation.create({
        participants: [req.user._id, participantId],
        isGroup: false,
        dmKey: dmKeyFor(req.user._id, participantId),
      });

      const populated = await newConversation.populate("participants", PUBLIC_USER_FIELDS);
      return res.status(201).json(populated);
    } catch (createError) {
      // 11000 = duplicate key: the other request created it first. Return
      // that one instead of failing or making a second DM.
      if (createError?.code === 11000) {
        const winner = await findExistingDm();
        if (winner) return res.status(200).json(winner);
      }
      throw createError;
    }
  } catch (error) {
    console.error("Create/get conversation error:", error);
    res.status(500).json({ message: "Server error creating conversation" });
  }
};

module.exports = { getConversations, createOrGetConversation };
