const User = require("../models/User");
const Session = require("../models/Session");
const { verifyToken } = require("./jwt");
const { isValidObjectId } = require("./validators");
const { shouldTouch } = require("./sessions");

/**
 * The one place that decides whether a login token may be used. Both the
 * REST middleware and the socket handshake call it, so they cannot disagree.
 *
 * A token is accepted only if ALL of these hold:
 *   - the signature is valid and it has not expired (verifyToken);
 *   - it names a real user and a session id;
 *   - that session still exists, belongs to that user and has not run out;
 *   - the user still exists.
 *
 * Throws jwt's own errors for bad or expired tokens, or an AuthFailure with
 * a `code` the client understands.
 */
class AuthFailure extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AuthFailure";
    this.code = code;
  }
}

const authenticate = async (token) => {
  const decoded = verifyToken(token);

  if (!isValidObjectId(decoded.id)) {
    throw new AuthFailure("Invalid token", "TOKEN_INVALID");
  }

  // Tokens made before sessions existed carry no session id. They are not
  // accepted: those users sign in once more.
  if (!isValidObjectId(decoded.sid)) {
    throw new AuthFailure("Invalid token", "TOKEN_INVALID");
  }

  const session = await Session.findOne({
    _id: decoded.sid,
    user: decoded.id,
    expiresAt: { $gt: new Date() },
  });
  if (!session) {
    throw new AuthFailure("This session has ended. Please sign in again.", "SESSION_ENDED");
  }

  const user = await User.findById(decoded.id).select("-password");
  if (!user) {
    throw new AuthFailure("User no longer exists", "TOKEN_INVALID");
  }

  // Remember when the session was last used (not on every request).
  if (shouldTouch(session.lastSeenAt)) {
    Promise.resolve(
      Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } })
    ).catch(() => {});
  }

  return { user, session, decoded };
};

module.exports = { authenticate, AuthFailure };
