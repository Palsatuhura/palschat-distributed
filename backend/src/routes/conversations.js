const express = require("express");
const { getConversations, createOrGetConversation } = require("../controllers/conversationController");
const { getMessages } = require("../controllers/messageController");
const { protect } = require("../middleware/auth");

const router = express.Router();

// All conversation routes are protected
router.use(protect);

// GET  /api/conversations — list all conversations for current user
router.get("/", getConversations);

// POST /api/conversations — create or get existing conversation
router.post("/", createOrGetConversation);

// GET  /api/conversations/:id/messages — fetch message history
router.get("/:id/messages", getMessages);

module.exports = router;
