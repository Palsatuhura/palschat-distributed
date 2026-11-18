const express = require("express");
const { getAllUsers, updateMe } = require("../controllers/userController");
const { protect } = require("../middleware/auth");

const router = express.Router();

// GET /api/users — protected; returns all users except current user
router.get("/", protect, getAllUsers);

// PATCH /api/users/me — protected; change your own picture / about line
router.patch("/me", protect, updateMe);

module.exports = router;
