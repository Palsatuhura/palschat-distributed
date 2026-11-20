const mongoose = require("mongoose");

/**
 * Message Schema
 * Each message belongs to a conversation and has one sender.
 * - deliveredTo: User IDs whose device received it (one tick -> two grey ticks)
 * - readBy: array of User IDs who have read this message (two blue ticks)
 */
const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: [true, "Message text is required"],
      trim: true,
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },
    // The message this one answers (a "reply"), or null.
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    // "Delete for everyone": the text is erased and this time is set.
    deletedAt: { type: Date, default: null },
    // "Delete for me": people who removed this message from their own view.
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Which users' devices have RECEIVED this message (shown as grey ticks).
    deliveredTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Track which users have seen this message
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true }
);

// History is always read as "newest messages of one conversation", so the
// index matches that query exactly (filter, then sort).
messageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("Message", messageSchema);
