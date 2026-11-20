const mongoose = require("mongoose");

/**
 * Attachment: one picture or file, stored in the database.
 *
 * Uploaded first, then named by a message. An upload that no message uses
 * within an hour is deleted by the database itself (TTL on expireAt). Once a
 * message claims it, expireAt is removed and it lives as long as the message.
 * The bytes (data) are never loaded unless asked for.
 */
const attachmentSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, maxlength: 100 },
    mime: { type: String, required: true },
    kind: { type: String, enum: ["image", "file"], required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
    used: { type: Boolean, default: false },
    expireAt: { type: Date },
  },
  { timestamps: true }
);

attachmentSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
attachmentSchema.index({ conversation: 1 });

module.exports = mongoose.model("Attachment", attachmentSchema);
