const express = require("express");
const { getAllUsers, updateMe } = require("../controllers/userController");
const { getBlocked, blockUser, unblockUser } = require("../controllers/blockController");
const { deleteMe } = require("../controllers/accountController");
const { passwordChangeLimiter } = require("../middleware/rateLimiter");
const { protect } = require("../middleware/auth");

const router = express.Router();

// GET /api/users — protected; returns all users except current user
router.get("/", protect, getAllUsers);

// PATCH /api/users/me — protected; change your own picture / about line
router.patch("/me", protect, updateMe);

// DELETE /api/users/me — protected; delete my own account (needs password)
router.delete("/me", protect, passwordChangeLimiter, deleteMe);

// Blocking (see controllers/blockController.js)
router.get("/blocked", protect, getBlocked);
router.post("/:id/block", protect, blockUser);
router.delete("/:id/block", protect, unblockUser);

module.exports = router;
