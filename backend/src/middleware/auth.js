const jwt = require("jsonwebtoken");
const User = require("../models/User");

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
      return res.status(401).json({ message: "Not authorized, no token provided" });
    }

    const token = authHeader.split(" ")[1];

    // Verify token using the JWT_SECRET
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch the user — exclude password from the query
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid token" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired, please log in again" });
    }
    return res.status(500).json({ message: "Server error in auth middleware" });
  }
};

module.exports = { protect };
