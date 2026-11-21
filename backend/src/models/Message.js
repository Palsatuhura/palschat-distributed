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
      // A picture or file may be sent without any words.
      required: [
        function () {
          return !(this.attachment && this.attachment.id);
        },
        "Message text is required",
      ],
      trim: true,
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },
    // A picture or file sent with this message (the bytes live in Attachment).
    // Random label from the sender's browser, so a retried send is not saved
    // twice (see utils/clientId.js).
    clientId: { type: String, maxlength: 64 },
    attachment: {
      type: new mongoose.Schema(
        {
          id: { type: mongoose.Schema.Types.ObjectId, ref: "Attachment" },
          name: { type: String },
          mime: { type: String },
          kind: { type: String },
          size: { type: Number },
        },
        { _id: false }
      ),
      default: undefined,
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

// One message per (sender, clientId). Messages without a clientId are exempt.
messageSchema.index(
  { sender: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } }
);

module.exports = mongoose.model("Message", messageSchema);
