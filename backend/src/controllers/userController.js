const User = require("../models/User");
const { PUBLIC_USER_FIELDS } = require("../utils/constants");

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
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select(PUBLIC_USER_FIELDS)
      .sort({ name: 1 });

    res.status(200).json(users);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ message: "Server error fetching users" });
  }
};

module.exports = { getAllUsers };
