const User = require("../models/User");
const { verifyToken } = require("../utils/jwt");
const { isValidObjectId } = require("../utils/validators");

/**
 * JWT Authentication Middleware
 * Extracts and verifies the Bearer token from the Authorization header.
 * On success, attaches the full user object to req.user.
 * On failure, returns a 401 Unauthorized response.
 */
const protect = async (req, res, next) => {
  try {
    // Extract token from "Authorization: Bearer <token>" header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ code: "NO_TOKEN", message: "Not authorized, no token provided" });
    }

    const token = authHeader.split(" ")[1];

    // Verify signature and expiry (algorithm is pinned in utils/jwt.js)
    const decoded = verifyToken(token);

    // A correctly signed token with a malformed id would otherwise throw a
    // CastError below and surface as a 500.
    if (!isValidObjectId(decoded.id)) {
      return res.status(401).json({ code: "TOKEN_INVALID", message: "Invalid token" });
    }

    // Fetch the user — exclude password from the query
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ code: "TOKEN_INVALID", message: "User no longer exists" });
    }

    req.user = user;
    next();
  } catch (error) {
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
