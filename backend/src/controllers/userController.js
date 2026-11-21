const User = require("../models/User");
const { PUBLIC_USER_FIELDS } = require("../utils/constants");
const { validateAvatar, validateAbout, validateName, validateGender, canSetGender } = require("../utils/validators");

/**
 * GET /api/users
 * Returns all registered users except the currently logged-in user.
 * Used to populate the sidebar contact/user list.
 * Sorted alphabetically by name.
 */
const getAllUsers = async (req, res) => {
  try {
    // Exclude the current user from results. Only public profile fields are
    // returned: other users' email addresses must not be exposed.
    const users = await User.find({ _id: { $ne: req.user._id }, deletedAt: null })
      .select(PUBLIC_USER_FIELDS)
      .sort({ name: 1 });

    res.status(200).json(users);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ message: "Server error fetching users" });
  }
};

/**
 * PATCH /api/users/me
 * Changes the logged-in user's own name, profile picture and/or "about" line.
 * Only those fields can be changed here (not the email or password), and only for yourself: the
 * user id always comes from the token, never from the request body.
 */
const updateMe = async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};

    if (body.name !== undefined) {
      const { name, error } = validateName(body.name);
      if (error) return res.status(400).json({ message: error });
      updates.name = name;
    }

    if (body.avatar !== undefined) {
      const { avatar, error } = validateAvatar(body.avatar);
      if (error) return res.status(400).json({ message: error });
      updates.avatar = avatar;
    }

    if (body.gender !== undefined) {
      const { gender, error } = validateGender(body.gender);
      if (error) return res.status(400).json({ message: error });
      // Gender is chosen once. It can only be filled in while it is still
      // "unspecified" (older accounts, or "prefer not to say" at signup).
      const current = await User.findById(req.user._id).select("gender");
      if (!current) return res.status(404).json({ message: "User not found" });
      if (!canSetGender(current.gender, gender)) {
        return res.status(403).json({ message: "Gender can only be set once" });
      }
      if (gender !== current.gender) updates.gender = gender;
    }

    if (body.about !== undefined) {
      const { about, error } = validateAbout(body.about);
      if (error) return res.status(400).json({ message: error });
      updates.about = about;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select(PUBLIC_USER_FIELDS);

    if (!user) return res.status(404).json({ message: "User not found" });

    const profile = {
      _id: user._id,
      name: user.name,
      avatar: user.avatar,
      gender: user.gender,
      about: user.about,
    };

    // Tell every connected client, on every server, so pictures and status
    // lines change live. Never let this fail the request.
    try {
      req.app.get("io")?.emit("user_updated", profile);
    } catch {
      /* ignore */
    }

    res.status(200).json(profile);
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ message: "Server error updating profile" });
  }
};

module.exports = { getAllUsers, updateMe };
