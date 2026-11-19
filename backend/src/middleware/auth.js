const { authenticate, AuthFailure } = require("../utils/authenticate");

/**
 * JWT Authentication Middleware
 * Extracts and verifies the Bearer token from the Authorization header, and
 * checks that its login session still exists (see utils/authenticate.js).
 * On success, attaches the user to req.user and the session to req.session.
 * On failure, returns a 401 Unauthorized response with a `code`.
 */
const protect = async (req, res, next) => {
  try {
    // Extract token from "Authorization: Bearer <token>" header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ code: "NO_TOKEN", message: "Not authorized, no token provided" });
    }

    const token = authHeader.split(" ")[1];

    const { user, session } = await authenticate(token);

    req.user = user;
    req.session = session;
    next();
  } catch (error) {
    if (error instanceof AuthFailure) {
      return res.status(401).json({ code: error.code, message: error.message });
    }
    if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
      return res.status(401).json({ code: "TOKEN_INVALID", message: "Invalid token" });
    }
    if (error.name === "TokenExpiredError") {
      // The client uses this code to show "your session expired" instead of a
      // generic error.
      return res.status(401).json({ code: "TOKEN_EXPIRED", message: "Token expired, please log in again" });
    }
    console.error("Auth middleware error:", error);
    return res.status(500).json({ message: "Server error in auth middleware" });
  }
};

module.exports = { protect };
