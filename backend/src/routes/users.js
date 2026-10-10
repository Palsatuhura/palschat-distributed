const express = require("express");
const { getAllUsers } = require("../controllers/userController");
const { protect } = require("../middleware/auth");

const router = express.Router();

// GET /api/users — protected; returns all users except current user
router.get("/", protect, getAllUsers);

module.exports = router;
