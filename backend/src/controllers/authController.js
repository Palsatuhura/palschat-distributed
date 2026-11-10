const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const { signToken } = require("../utils/jwt");
const {
  normalizeEmail,
  validateNewPassword,
  validateName,
} = require("../utils/validators");
const { MAX_LOGIN_PASSWORD_LENGTH } = require("../utils/constants");

/**
 * A real bcrypt hash of a random value nobody knows.
 *
 * When a login names an email that does not exist, we still run one bcrypt
 * comparison against this hash. Otherwise "unknown email" answers in a
 * millisecond while "wrong password" takes ~250 ms, and an attacker can use
 * the difference to discover which email addresses have accounts.
 */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);

const publicUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  isOnline: user.isOnline,
});

/**
 * POST /api/auth/register
 * Creates a new user account.
 * - Validates and normalizes every field (types, lengths, email format)
 * - Rejects duplicate emails
 * - Saves user (password is hashed via pre-save hook in User model)
 * - Returns user info + JWT token
 */
const register = async (req, res) => {
  try {
    const body = req.body || {};

    const { name, error: nameError } = validateName(body.name);
    if (nameError) {
      return res.status(400).json({ message: nameError });
    }

    const email = normalizeEmail(body.email);
    if (!email) {
      return res.status(400).json({ message: "Please provide a valid email address" });
    }

    const passwordError = validateNewPassword(body.password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    // `email` is a validated string, so it cannot carry a query operator.
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "Email already in use" });
    }

    // Create user (password hashed automatically by mongoose pre-save hook)
    const user = await User.create({ name, email, password: body.password });

    const token = signToken(user._id);

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    // Two registrations for the same email at the same instant both pass the
    // findOne check above; the unique index makes the second one fail here.
    if (error.code === 11000) {
      return res.status(409).json({ message: "Email already in use" });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ message: messages.join(", ") });
    }
    console.error("Register error:", error);
    res.status(500).json({ message: "Server error during registration" });
  }
};

/**
 * POST /api/auth/login
 * Authenticates an existing user.
 * - Accepts only string email/password (no query-operator objects)
 * - Always performs one bcrypt comparison, so timing does not reveal
 *   whether the account exists
 * - Gives the same answer for "no such user" and "wrong password"
 */
const login = async (req, res) => {
  try {
    const body = req.body || {};

    if (typeof body.email !== "string" || typeof body.password !== "string" || !body.email || !body.password) {
      return res.status(400).json({ message: "Please provide email and password" });
    }

    // Bound the work bcrypt is asked to do for a single request.
    if (body.password.length > MAX_LOGIN_PASSWORD_LENGTH) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const email = normalizeEmail(body.email);

    // Include password field (it's excluded by default via select: false)
    const user = email ? await User.findOne({ email }).select("+password") : null;

    if (!user) {
      await bcrypt.compare(body.password, DUMMY_HASH);
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await user.comparePassword(body.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = signToken(user._id);

    res.status(200).json({
      message: "Login successful",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
};

module.exports = { register, login };
