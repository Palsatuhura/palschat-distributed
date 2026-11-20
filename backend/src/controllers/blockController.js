const User = require("../models/User");
const { isValidObjectId } = require("../utils/validators");

/**
 * Blocking. The list is private: only its owner ever receives it.
 *
 *   GET    /api/users/blocked        my blocked people (ids)
 *   POST   /api/users/:id/block      block someone
 *   DELETE /api/users/:id/block      unblock them
 *
 * While a block exists, NEITHER side can send into their one-to-one chat
 * (the socket layer checks it on every message). Groups are not affected.
 * The ids always come from the login token, never from the request body.
 */

const room = (userId) => `user:${userId}`;

const myBlockedIds = async (userId) => {
  const me = await User.findById(userId).select("blocked").lean();
  return (me?.blocked || []).map(String);
};

const tellMyDevices = (req, blocked) => {
  try {
    req.app.get("io")?.to(room(req.user._id)).emit("blocks_updated", { blocked });
  } catch {
    /* live update is best effort */
  }
};

const getBlocked = async (req, res) => {
  try {
    res.status(200).json({ blocked: await myBlockedIds(req.user._id) });
  } catch (error) {
    console.error("Get blocked error:", error);
    res.status(500).json({ message: "Server error loading blocked people" });
  }
};

const change = (adding) => async (req, res) => {
  try {
    const targetId = req.params.id;
    if (!isValidObjectId(targetId)) return res.status(400).json({ message: "Invalid user id" });
    if (String(targetId).toLowerCase() === String(req.user._id).toLowerCase()) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    if (adding) {
      const target = await User.exists({ _id: targetId, deletedAt: null });
      if (!target) return res.status(404).json({ message: "User not found" });
    }

    await User.updateOne(
      { _id: req.user._id },
      adding ? { $addToSet: { blocked: targetId } } : { $pull: { blocked: targetId } }
    );

    const blocked = await myBlockedIds(req.user._id);
    tellMyDevices(req, blocked);
    res.status(200).json({ blocked });
  } catch (error) {
    console.error("Block error:", error);
    res.status(500).json({ message: "Server error changing the block" });
  }
};

module.exports = { getBlocked, blockUser: change(true), unblockUser: change(false) };
