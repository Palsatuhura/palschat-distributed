const express = require("express");
const { register, login } = require("../controllers/authController");
const {
  refresh,
  listSessions,
  revokeSession,
  logout,
  logoutAll,
  changePassword,
} = require("../controllers/sessionController");
const { protect } = require("../middleware/auth");
const {
  loginIpLimiter,
  loginAccountLimiter,
  registerLimiter,
  passwordChangeLimiter,
} = require("../middleware/rateLimiter");

const router = express.Router();

// POST /api/auth/register
router.post("/register", registerLimiter, register);

// POST /api/auth/login
// Two independent budgets of FAILED attempts: one per IP address, one per
// account. Successful logins do not consume either.
router.post("/login", loginIpLimiter, loginAccountLimiter, login);

// Sessions (all need a valid login; see controllers/sessionController.js)
// POST   /api/auth/refresh          — renew the current login quietly
// GET    /api/auth/sessions         — my logged-in devices
// DELETE /api/auth/sessions/:id     — end one of them
// POST   /api/auth/logout           — end this login
// POST   /api/auth/logout-all       — end every login
// POST   /api/auth/change-password  — change password, end the other logins
router.post("/refresh", protect, refresh);
router.get("/sessions", protect, listSessions);
router.delete("/sessions/:id", protect, revokeSession);
router.post("/logout", protect, logout);
router.post("/logout-all", protect, logoutAll);
router.post("/change-password", protect, passwordChangeLimiter, changePassword);

module.exports = router;
