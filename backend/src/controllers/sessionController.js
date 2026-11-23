const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Session = require("../models/Session");
const { signToken, verifyToken } = require("../utils/jwt");
const { resolveTokenSeconds } = require("../config/env");
const { tokenSecondsFor } = require("../utils/sessions");
const { endSessionsLive } = require("../utils/sessionService");
const { isValidObjectId, validateNewPassword } = require("../utils/validators");
const { MAX_LOGIN_PASSWORD_LENGTH } = require("../utils/constants");

/**
 * Login sessions: renew, list, end one, end all, sign out, change password.
 *
 * Every route here sits behind `protect`, so req.user and req.session come
 * from the verified token, never from the request body. Deleting a session
 * ends that login immediately (see utils/authenticate.js).
 */

const io = (req) => req.app.get("io");

/**
 * POST /api/auth/refresh
 * Gives the current session a fresh token, so someone who is using the app
 * is not signed out at the original expiry. It can never extend a session
 * past its own end (SESSION_MAX_DAYS).
 */
const refresh = async (req, res) => {
  try {
    const seconds = tokenSecondsFor(
      req.session.expiresAt,
      resolveTokenSeconds(process.env.JWT_EXPIRES_IN)
    );
    if (seconds === 0) {
      return res.status(401).json({
        code: "TOKEN_EXPIRED",
        message: "This session has reached its limit. Please sign in again.",
      });
    }

    const token = signToken(req.user._id, req.session._id, seconds);
    await Session.updateOne({ _id: req.session._id }, { $set: { lastSeenAt: new Date() } });

    res.status(200).json({ token, expiresAt: new Date(Date.now() + seconds * 1000) });
  } catch (error) {
    console.error("Refresh error:", error);
    res.status(500).json({ message: "Server error renewing the session" });
  }
};

/** GET /api/auth/sessions — the logged-in user's own sessions. */
const listSessions = async (req, res) => {
  try {
    const sessions = await Session.find({
      user: req.user._id,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastSeenAt: -1 })
      .limit(50);

    res.status(200).json(
      sessions.map((s) => ({
        id: String(s._id),
        device: s.device,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: String(s._id) === String(req.session._id),
      }))
    );
  } catch (error) {
    console.error("List sessions error:", error);
    res.status(500).json({ message: "Server error loading sessions" });
  }
};

/** DELETE /api/auth/sessions/:id — end one of MY sessions. */
const revokeSession = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid session id" });
    }

    // The user is part of the filter, so nobody can end someone else's session.
    const result = await Session.deleteOne({ _id: id, user: req.user._id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Session not found" });
    }

    endSessionsLive(io(req), [id]);
    res.status(200).json({ id, current: String(id) === String(req.session._id) });
  } catch (error) {
    console.error("Revoke session error:", error);
    res.status(500).json({ message: "Server error ending the session" });
  }
};

/**
 * POST /api/auth/logout — end the current session.
 *
 * Deliberately NOT behind `protect`: someone whose token has just expired
 * must still be able to sign out and have the session removed from the list.
 * The token's signature is still fully checked; only its expiry is ignored,
 * and the session is deleted only if it belongs to the user named in it.
 */
const logout = async (req, res) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.split(" ")[1] : "";
    let decoded;
    try {
      decoded = verifyToken(token, { ignoreExpiration: true });
    } catch {
      return res.status(401).json({ code: "TOKEN_INVALID", message: "Invalid token" });
    }

    if (isValidObjectId(decoded.sid) && isValidObjectId(decoded.id)) {
      await Session.deleteOne({ _id: decoded.sid, user: decoded.id });
      endSessionsLive(io(req), [decoded.sid]);
    }
    res.status(200).json({ message: "Signed out" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ message: "Server error signing out" });
  }
};

/** POST /api/auth/logout-all — end every session, on every device. */
const logoutAll = async (req, res) => {
  try {
    const sessions = await Session.find({ user: req.user._id }).select("_id");
    await Session.deleteMany({ user: req.user._id });
    endSessionsLive(io(req), sessions.map((s) => s._id));
    res.status(200).json({ message: "Signed out everywhere", ended: sessions.length });
  } catch (error) {
    console.error("Logout all error:", error);
    res.status(500).json({ message: "Server error signing out" });
  }
};

/**
 * POST /api/auth/change-password
 * body: { currentPassword, newPassword }
 * Needs the current password. Every OTHER session is ended, so a stolen
 * login stops working; this device stays signed in.
 */
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== "string" || !currentPassword) {
      return res.status(400).json({ message: "Please enter your current password" });
    }
    if (currentPassword.length > MAX_LOGIN_PASSWORD_LENGTH) {
      return res.status(401).json({ message: "Your current password is not correct" });
    }

    const passwordError = validateNewPassword(newPassword);
    if (passwordError) return res.status(400).json({ message: passwordError });

    if (newPassword === currentPassword) {
      return res.status(400).json({ message: "Choose a password different from the current one" });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user) return res.status(401).json({ code: "TOKEN_INVALID", message: "User no longer exists" });

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      return res.status(401).json({ message: "Your current password is not correct" });
    }

    user.password = newPassword; // hashed by the model's pre-save hook
    await user.save();

    const others = await Session.find({
      user: req.user._id,
      _id: { $ne: req.session._id },
    }).select("_id");
    await Session.deleteMany({ user: req.user._id, _id: { $ne: req.session._id } });
    endSessionsLive(io(req), others.map((s) => s._id));

    res.status(200).json({ message: "Password changed", endedOtherSessions: others.length });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Server error changing password" });
  }
};

module.exports = { refresh, listSessions, revokeSession, logout, logoutAll, changePassword };
