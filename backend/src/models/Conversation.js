const mongoose = require("mongoose");

/**
 * Conversation Schema
 * Represents both 1-on-1 and group conversations.
 * - participants: array of User references (2 for DM, 3+ for group)
 * - isGroup: flag to distinguish DM from group chat
 * - groupName: only set for group conversations
 * - lastMessage: denormalized reference for quick sidebar preview
 */
const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    isGroup: {
      type: Boolean,
      default: false,
    },
    groupName: {
      type: String,
      trim: true,
      default: "",
    },
    // Reference to the last message for sidebar preview
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", conversationSchema);
