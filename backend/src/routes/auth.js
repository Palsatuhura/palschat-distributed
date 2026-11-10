const express = require("express");
const { register, login } = require("../controllers/authController");
const {
  loginIpLimiter,
  loginAccountLimiter,
  registerLimiter,
} = require("../middleware/rateLimiter");

const router = express.Router();

// POST /api/auth/register
router.post("/register", registerLimiter, register);

// POST /api/auth/login
// Two independent budgets of FAILED attempts: one per IP address, one per
// account. Successful logins do not consume either.
router.post("/login", loginIpLimiter, loginAccountLimiter, login);

module.exports = router;
