const express = require("express");
const { getConversations, createOrGetConversation } = require("../controllers/conversationController");
const { getMessages, deleteMessage } = require("../controllers/messageController");
const {
  updateGroup,
  addGroupMembers,
  removeGroupMember,
  makeAdmin,
  removeAdmin,
} = require("../controllers/groupController");
const { uploadAttachment, downloadAttachment } = require("../controllers/attachmentController");
const { uploadLimiter } = require("../middleware/rateLimiter");
const { MAX_ATTACHMENT_BYTES } = require("../utils/constants");
const { clearChat, deleteChat, setPrefs } = require("../controllers/chatController");
const { protect } = require("../middleware/auth");

const router = express.Router();

// All conversation routes are protected
router.use(protect);

// GET  /api/conversations — list all conversations for current user
router.get("/", getConversations);

// POST /api/conversations — create or get existing conversation
router.post("/", createOrGetConversation);

// Group management (see controllers/groupController.js for the rules)
// PATCH  /api/conversations/:id/group              — name, icon, description (admin)
// POST   /api/conversations/:id/members            — add people (admin)
// DELETE /api/conversations/:id/members/:userId    — remove someone, or leave
// PUT    /api/conversations/:id/admins/:userId     — make admin (admin)
// DELETE /api/conversations/:id/admins/:userId     — remove admin (admin)
router.patch("/:id/group", updateGroup);
router.post("/:id/members", addGroupMembers);
router.delete("/:id/members/:userId", removeGroupMember);
router.put("/:id/admins/:userId", makeAdmin);
router.delete("/:id/admins/:userId", removeAdmin);

// Per-person chat state (see controllers/chatController.js)
// POST   /api/conversations/:id/clear   — clear the chat for me only
// DELETE /api/conversations/:id         — remove the chat from my list
router.post("/:id/clear", clearChat);
// POST   /api/conversations/:id/prefs   — pin / mute / archive, for me only
router.post("/:id/prefs", setPrefs);

// Pictures and files. The body is the raw file, so these two routes get their
// own parser with a size limit (the rest of the API only takes small JSON).
router.post(
  "/:id/attachments",
  uploadLimiter,
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  uploadAttachment
);
router.get("/:id/attachments/:attachmentId", downloadAttachment);
router.delete("/:id", deleteChat);

// GET  /api/conversations/:id/messages — fetch message history
router.get("/:id/messages", getMessages);

// DELETE /api/conversations/:id/messages/:messageId?scope=me|everyone
router.delete("/:id/messages/:messageId", deleteMessage);

module.exports = router;
