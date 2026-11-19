const mongoose = require("mongoose");

/**
 * One login on one device.
 *
 * Every login token carries the id of its session (`sid`). A token is only
 * accepted while its session still exists, so deleting a session ends that
 * login at once ("sign out", "sign out everywhere", "remove this device",
 * a password change), even though the token itself has not expired yet.
 *
 * MongoDB removes a session by itself once `expiresAt` has passed (TTL index),
 * which is also the longest a login can last without signing in again.
 */
const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Short, human-readable, for example "Chrome on Windows".
    device: {
      type: String,
      default: "Unknown device",
      maxlength: 120,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// "My sessions", newest activity first.
sessionSchema.index({ user: 1, lastSeenAt: -1 });

// Automatic clean-up once the session has run out.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Session", sessionSchema);
