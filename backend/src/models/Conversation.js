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
    // Only for 1-on-1 chats: "<lowerId>:<higherId>". See dmKeyFor().
    dmKey: {
      type: String,
      default: undefined,
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

// "My conversations, newest first" (the sidebar query).
conversationSchema.index({ participants: 1, updatedAt: -1 });

// At most one DM per pair of users. Partial, so groups and DMs created before
// this field existed (no dmKey) are not affected.
conversationSchema.index(
  { dmKey: 1 },
  { unique: true, partialFilterExpression: { dmKey: { $type: "string" } } }
);

module.exports = mongoose.model("Conversation", conversationSchema);
