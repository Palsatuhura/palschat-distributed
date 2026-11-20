const Conversation = require("../models/Conversation");
const Attachment = require("../models/Attachment");
const { isValidObjectId } = require("../utils/validators");
const { detectType, cleanFileName } = require("../utils/attachmentTypes");
const { MAX_ATTACHMENT_BYTES } = require("../utils/constants");

const UNUSED_LIFETIME_MS = 60 * 60 * 1000;

const findMine = (conversationId, userId) =>
  isValidObjectId(conversationId)
    ? Conversation.findOne({ _id: conversationId, participants: userId }).select("_id readOnly")
    : null;

/**
 * POST /api/conversations/:id/attachments
 * The request body IS the file (raw bytes). The name comes in the
 * X-File-Name header (URL-encoded). Answers { id, name, mime, kind, size }
 * which the sender then puts in a message.
 */
const uploadAttachment = async (req, res) => {
  try {
    const conversation = await findMine(req.params.id, req.user._id);
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    if (conversation.readOnly) {
      return res.status(403).json({ message: "This account was deleted. You can no longer send here." });
    }

    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ message: "No file received" });
    }
    if (body.length > MAX_ATTACHMENT_BYTES) {
      return res.status(413).json({ message: "That file is too big (4 MB at most)" });
    }

    let rawName = "";
    try {
      rawName = decodeURIComponent(String(req.get("x-file-name") || ""));
    } catch {
      rawName = "";
    }
    const name = cleanFileName(rawName);

    const type = detectType(body, name);
    if (!type) {
      return res.status(415).json({
        message: "This kind of file is not allowed. Send a picture, PDF, Word, Excel, PowerPoint, text or CSV file.",
      });
    }

    const saved = await Attachment.create({
      conversation: conversation._id,
      uploader: req.user._id,
      name,
      mime: type.mime,
      kind: type.kind,
      size: body.length,
      data: body,
      expireAt: new Date(Date.now() + UNUSED_LIFETIME_MS),
    });

    res.status(201).json({
      id: String(saved._id),
      name,
      mime: type.mime,
      kind: type.kind,
      size: body.length,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "Server error saving the file" });
  }
};

const encodeName = (name) => encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16));

/**
 * GET /api/conversations/:id/attachments/:attachmentId
 * Members of the conversation only. The file is answered with the type the
 * server worked out itself, and with headers that stop a browser from ever
 * running it as a page.
 */
const downloadAttachment = async (req, res) => {
  try {
    const { id: conversationId, attachmentId } = req.params;
    if (!isValidObjectId(conversationId) || !isValidObjectId(attachmentId)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const conversation = await findMine(conversationId, req.user._id);
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });

    // Must belong to THIS conversation, and be in use by a message (or be my
    // own fresh upload), so ids cannot reach files of other chats.
    const file = await Attachment.findOne({ _id: attachmentId, conversation: conversationId }).select("+data");
    if (!file || (!file.used && String(file.uploader) !== String(req.user._id))) {
      return res.status(404).json({ message: "File not found" });
    }

    res.set({
      "Content-Type": file.mime,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${file.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${encodeName(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=3600",
    });
    res.status(200).end(file.data);
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ message: "Server error loading the file" });
  }
};

module.exports = { uploadAttachment, downloadAttachment };
