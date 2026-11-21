const User = require("../models/User");
const Session = require("../models/Session");
const { endSessionsLive } = require("../utils/sessionService");
const { normalizeEmail, validateNewPassword } = require("../utils/validators");
const { sendMail } = require("../utils/mailer");
const { allowedOrigins } = require("../config/cors");
const logger = require("../utils/logger");
const {
  RESET_TTL_MS,
  hashResetToken,
  newResetToken,
  isValidTokenShape,
  resetLink,
  issuedRecently,
} = require("../utils/passwordReset");

const GENERIC = "If an account exists for that email, we have sent a link to reset the password.";
const BAD_LINK = "This reset link is not valid or has expired. Please ask for a new one.";

const appUrl = () => process.env.APP_URL || allowedOrigins[0];

const emailBody = (name, link) => {
  const minutes = RESET_TTL_MS / 60000;
  const text =
    `Hello ${name},\n\nSomeone asked to reset your PalsChat password. ` +
    `Open this link within ${minutes} minutes to choose a new one:\n\n${link}\n\n` +
    `If it was not you, ignore this email; your password stays the same.`;
  const html =
    `<p>Hello ${String(name).replace(/[<>&"]/g, "")},</p>` +
    `<p>Someone asked to reset your PalsChat password. The link works for ${minutes} minutes.</p>` +
    `<p><a href="${link}">Choose a new password</a></p>` +
    `<p>If it was not you, ignore this email; your password stays the same.</p>`;
  return { text, html };
};

/**
 * POST /api/auth/forgot-password { email }
 * Always answers the same way, whether or not the email has an account, so
 * the form cannot be used to find out who is registered.
 */
const forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail((req.body || {}).email);
    if (!email) return res.status(400).json({ message: "Please provide a valid email address" });

    const user = await User.findOne({ email }).select("_id name email +resetExpiresAt");
    if (user && !issuedRecently(user.resetExpiresAt)) {
      const { token, hash } = newResetToken();
      await User.updateOne(
        { _id: user._id },
        { $set: { resetTokenHash: hash, resetExpiresAt: new Date(Date.now() + RESET_TTL_MS) } }
      );
      const { text, html } = emailBody(user.name, resetLink(appUrl(), token));
      // Not awaited: the answer must not depend on how fast the mail goes.
      sendMail({ to: user.email, subject: "Reset your PalsChat password", text, html }).catch((e) =>
        logger.error("Reset email failed:", e.message)
      );
    }
    res.status(200).json({ message: GENERIC });
  } catch (error) {
    logger.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error. Please try again." });
  }
};

/**
 * POST /api/auth/reset-password { token, newPassword }
 * Sets the new password, uses up the link and signs the account out of every
 * device (whoever knew the old password loses access).
 */
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!isValidTokenShape(token)) return res.status(400).json({ message: BAD_LINK });

    const passwordError = validateNewPassword(newPassword);
    if (passwordError) return res.status(400).json({ message: passwordError });

    const user = await User.findOne({
      resetTokenHash: hashResetToken(token),
      resetExpiresAt: { $gt: new Date() },
    }).select("+password +resetTokenHash +resetExpiresAt");
    if (!user) return res.status(400).json({ message: BAD_LINK });

    user.password = newPassword; // hashed by the model's pre-save hook
    user.resetTokenHash = undefined;
    user.resetExpiresAt = undefined;
    await user.save();

    const sessions = await Session.find({ user: user._id }).select("_id");
    await Session.deleteMany({ user: user._id });
    endSessionsLive(req.app.get("io"), sessions.map((s) => s._id));

    res.status(200).json({ message: "Password changed. You can sign in now." });
  } catch (error) {
    logger.error("Reset password error:", error);
    res.status(500).json({ message: "Server error. Please try again." });
  }
};

module.exports = { forgotPassword, resetPassword };
