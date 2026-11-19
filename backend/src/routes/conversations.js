const express = require("express");
const { getConversations, createOrGetConversation } = require("../controllers/conversationController");
const { getMessages } = require("../controllers/messageController");
const {
  updateGroup,
  addGroupMembers,
  removeGroupMember,
  makeAdmin,
  removeAdmin,
} = require("../controllers/groupController");
const { clearChat, deleteChat } = require("../controllers/chatController");
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
router.delete("/:id", deleteChat);

// GET  /api/conversations/:id/messages — fetch message history
router.get("/:id/messages", getMessages);

module.exports = router;
