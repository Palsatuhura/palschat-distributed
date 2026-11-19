const express = require("express");
const { getAllUsers, updateMe } = require("../controllers/userController");
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

module.exports = router;
