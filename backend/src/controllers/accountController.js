const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Session = require("../models/Session");
const Conversation = require("../models/Conversation");
const { endSessionsLive } = require("../utils/sessionService");
const { removeUserFromGroup } = require("./groupController");
const { MAX_LOGIN_PASSWORD_LENGTH } = require("../utils/constants");

/**
 * DELETE /api/users/me
 * body: { password, confirm: "DELETE" }
 *
 * Deletes the logged-in person's account. It cannot be undone.
 *
 * What happens:
 *   - they must give their password and type DELETE;
 *   - they leave every group (a group always keeps an admin; if they were the
 *     last member it is removed);
 *   - their one-to-one chats stay for the other person, closed to new
 *     messages, and show "Deleted user";
 *   - their messages stay, shown as from "Deleted user";
 *   - their name, picture, about line and email are erased, and the email
 *     can be used to register again;
 *   - every login of theirs ends at once, on every device.
 *
 * The record is anonymised rather than removed, so other people's chat
 * history keeps working.
 */
const deleteMe = async (req, res) => {
  try {
    const { password, confirm } = req.body || {};

    if (confirm !== "DELETE") {
      return res.status(400).json({ message: 'Type DELETE to confirm' });
    }
    if (typeof password !== "string" || !password) {
      return res.status(400).json({ message: "Please enter your password" });
    }
    if (password.length > MAX_LOGIN_PASSWORD_LENGTH) {
      return res.status(401).json({ message: "Your password is not correct" });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user || user.deletedAt) {
      return res.status(401).json({ code: "TOKEN_INVALID", message: "User no longer exists" });
    }

    // No code on this 401: a wrong password must not look like an ended
    // session to the app.
    if (!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Your password is not correct" });
    }

    const userId = String(user._id);

    // 1. Leave every group.
    const groups = await Conversation.find({ isGroup: true, participants: user._id });
    for (const group of groups) {
      await removeUserFromGroup(req, group, userId);
    }

    // 2. One-to-one chats stay, but nobody can write into them any more.
    await Conversation.updateMany(
      { isGroup: false, participants: user._id },
      { $set: { readOnly: true } }
    );

    // 3. Erase the person (the record stays so old messages still resolve).
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          name: "Deleted user",
          email: `deleted-${userId}@deleted.invalid`,
          password: "!deleted", // not a valid hash: nothing can ever match it
          avatar: "",
          gender: "unspecified",
          about: "",
          isOnline: false,
          deletedAt: new Date(),
        },
      }
    );

    // 4. End every login, on every device, and close their open sockets.
    const sessions = await Session.find({ user: user._id }).select("_id");
    await Session.deleteMany({ user: user._id });

    const io = req.app.get("io");
    endSessionsLive(io, sessions.map((s) => s._id));

    // 5. Tell everyone connected (on any server).
    try {
      io?.emit("user_updated", {
        _id: userId,
        name: "Deleted user",
        avatar: "",
        gender: "unspecified",
        about: "",
        deletedAt: new Date(),
      });
      io?.emit("user_removed", { _id: userId });
    } catch {
      /* live update is best effort */
    }

    res.status(200).json({ message: "Your account was deleted" });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ message: "Server error deleting the account" });
  }
};

module.exports = { deleteMe };
