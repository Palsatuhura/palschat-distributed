const { stripPrivate } = require("../utils/chatState");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const {
  isValidObjectId,
  normalizeParticipantIds,
  validateAvatar,
  validateGroupName,
  validateGroupDescription,
} = require("../utils/validators");
const { PUBLIC_USER_FIELDS } = require("../utils/constants");
const groups = require("../utils/groups");

/**
 * Group management: edit the group, add and remove members, make and remove
 * admins, leave.
 *
 * Rules (see utils/groups.js):
 *   - only admins can edit the group, add or remove other people, or change
 *     who is an admin;
 *   - anyone can remove THEMSELVES (leave);
 *   - a group always keeps at least one admin;
 *   - the person making the request always comes from the login token.
 *
 * After every change, everyone in the group (on any server) is sent the new
 * version live, and people who were removed are told to drop it.
 */

const room = (userId) => `user:${userId}`;

/** The group, only if it exists AND the caller is a member. */
const findMyGroup = async (conversationId, userId) => {
  if (!isValidObjectId(conversationId)) return null;
  return Conversation.findOne({
    _id: conversationId,
    isGroup: true,
    participants: userId,
  });
};

/** Same shape as GET /api/conversations returns for one conversation. */
const loadForClient = async (conversationId) => {
  const conversation = await Conversation.findById(conversationId)
    .populate("participants", PUBLIC_USER_FIELDS)
    .populate({
      path: "lastMessage",
      populate: { path: "sender", select: "name" },
    });
  // Nobody's private settings (pin, mute, archive...) travel with it.
  return conversation ? stripPrivate(conversation) : conversation;
};

const emitToUsers = (io, userIds, event, payload) => {
  if (!io || userIds.length === 0) return;
  let target = io;
  for (const id of userIds) target = target.to(room(id));
  target.emit(event, payload);
};

/**
 * Tell people what changed.
 *   currentIds: everyone who is in the group now  -> conversation_updated
 *   removedIds: people who just left or were removed -> conversation_removed
 */
const announce = async (req, conversationId, currentIds, removedIds = []) => {
  try {
    const io = req.app.get("io");
    if (!io) return;

    if (currentIds.length > 0) {
      const fresh = await loadForClient(conversationId);
      if (fresh) emitToUsers(io, currentIds, "conversation_updated", fresh);
    }

    if (removedIds.length > 0) {
      emitToUsers(io, removedIds, "conversation_removed", { _id: String(conversationId) });
      // They must stop receiving anything sent to the group's room.
      for (const id of removedIds) {
        io.in(room(id)).socketsLeave(String(conversationId));
      }
    }
  } catch (error) {
    // The change itself already succeeded; live updates are best effort.
    console.error("Group announce error:", error.message);
  }
};

const notFound = (res) => res.status(404).json({ message: "Group not found" });
const forbidden = (res) =>
  res.status(403).json({ message: "Only group admins can do that" });

const saveMembership = async (group, result) => {
  group.participants = result.participants;
  group.admins = result.admins;
  await group.save();
};

/**
 * PATCH /api/conversations/:id/group
 * body: { groupName?, groupAvatar?, groupDescription? }   (admins only)
 */
const updateGroup = async (req, res) => {
  try {
    const group = await findMyGroup(req.params.id, req.user._id);
    if (!group) return notFound(res);
    if (!groups.isGroupAdmin(group, req.user._id)) return forbidden(res);

    const body = req.body || {};
    const updates = {};

    if (body.groupName !== undefined) {
      const { groupName, error } = validateGroupName(body.groupName);
      if (error) return res.status(400).json({ message: error });
      updates.groupName = groupName;
    }
    if (body.groupAvatar !== undefined) {
      const { avatar, error } = validateAvatar(body.groupAvatar);
      if (error) return res.status(400).json({ message: error });
      updates.groupAvatar = avatar;
    }
    if (body.groupDescription !== undefined) {
      const { groupDescription, error } = validateGroupDescription(body.groupDescription);
      if (error) return res.status(400).json({ message: error });
      updates.groupDescription = groupDescription;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    Object.assign(group, updates);
    // Groups made before admins existed: write the implied admin down now.
    group.admins = groups.adminIdsOf(group.participants, group.admins);
    await group.save();

    const currentIds = group.participants.map(String);
    await announce(req, group._id, currentIds);
    res.status(200).json(await loadForClient(group._id));
  } catch (error) {
    console.error("Update group error:", error);
    res.status(500).json({ message: "Server error updating group" });
  }
};

/**
 * POST /api/conversations/:id/members
 * body: { userIds: [...] }   (admins only)
 */
const addGroupMembers = async (req, res) => {
  try {
    const group = await findMyGroup(req.params.id, req.user._id);
    if (!group) return notFound(res);
    if (!groups.isGroupAdmin(group, req.user._id)) return forbidden(res);

    const { ids, error: idsError } = normalizeParticipantIds(
      (req.body || {}).userIds,
      req.user._id
    );
    if (idsError) return res.status(400).json({ message: idsError });
    if (ids.length === 0) return res.status(400).json({ message: "Choose at least one person" });

    const found = await User.countDocuments({ deletedAt: null, _id: { $in: ids } });
    if (found !== ids.length) {
      return res.status(400).json({ message: "One or more people do not exist" });
    }

    const result = groups.addMembers(group, ids);
    if (result.error) return res.status(400).json({ message: result.error });

    await saveMembership(group, result);
    await announce(req, group._id, result.participants);
    res.status(200).json(await loadForClient(group._id));
  } catch (error) {
    console.error("Add members error:", error);
    res.status(500).json({ message: "Server error adding members" });
  }
};

/**
 * DELETE /api/conversations/:id/members/:userId
 * Admins can remove anyone; anyone can remove themselves (leave).
 */
const removeGroupMember = async (req, res) => {
  try {
    const group = await findMyGroup(req.params.id, req.user._id);
    if (!group) return notFound(res);

    const targetId = req.params.userId;
    if (!isValidObjectId(targetId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const isSelf = targetId.toLowerCase() === String(req.user._id).toLowerCase();
    if (!isSelf && !groups.isGroupAdmin(group, req.user._id)) return forbidden(res);

    const result = groups.removeMember(group, targetId);
    if (result.error) return res.status(400).json({ message: result.error });

    // The last person leaving closes the group down.
    if (result.participants.length === 0) {
      await Message.deleteMany({ conversation: group._id });
      await Conversation.deleteOne({ _id: group._id });
      await announce(req, group._id, [], [String(req.user._id)]);
      return res.status(200).json({ _id: String(group._id), removed: true });
    }

    await saveMembership(group, result);
    await announce(req, group._id, result.participants, [targetId.toLowerCase()]);

    if (isSelf) return res.status(200).json({ _id: String(group._id), removed: true });
    res.status(200).json(await loadForClient(group._id));
  } catch (error) {
    console.error("Remove member error:", error);
    res.status(500).json({ message: "Server error removing member" });
  }
};

/** PUT /api/conversations/:id/admins/:userId (admins only) */
const makeAdmin = async (req, res) => changeAdmin(req, res, "promote");

/** DELETE /api/conversations/:id/admins/:userId (admins only) */
const removeAdmin = async (req, res) => changeAdmin(req, res, "demote");

const changeAdmin = async (req, res, action) => {
  try {
    const group = await findMyGroup(req.params.id, req.user._id);
    if (!group) return notFound(res);
    if (!groups.isGroupAdmin(group, req.user._id)) return forbidden(res);

    if (!isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const result = groups[action](group, req.params.userId);
    if (result.error) return res.status(400).json({ message: result.error });

    await saveMembership(group, result);
    await announce(req, group._id, result.participants);
    res.status(200).json(await loadForClient(group._id));
  } catch (error) {
    console.error("Change admin error:", error);
    res.status(500).json({ message: "Server error changing admin" });
  }
};

/**
 * Used when an account is deleted: that person leaves this group, with the
 * same rules as leaving (an admin is promoted if needed; the last member
 * closes the group). Everyone else is told live.
 */
const removeUserFromGroup = async (req, group, userId) => {
  const result = groups.removeMember(group, userId);
  if (result.error) return; // not a member any more

  if (result.participants.length === 0) {
    await Message.deleteMany({ conversation: group._id });
    await Conversation.deleteOne({ _id: group._id });
    await announce(req, group._id, [], [String(userId)]);
    return;
  }

  await saveMembership(group, result);
  await announce(req, group._id, result.participants, [String(userId).toLowerCase()]);
};

module.exports = {
  removeUserFromGroup,
  updateGroup,
  addGroupMembers,
  removeGroupMember,
  makeAdmin,
  removeAdmin,
};
