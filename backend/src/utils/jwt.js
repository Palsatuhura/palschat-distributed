const jwt = require("jsonwebtoken");
const { resolveTokenSeconds } = require("../config/env");

/**
 * The single place where tokens are created and checked.
 *
 * The algorithm is pinned on both sides. Without `algorithms` in verify, a
 * library may accept whatever algorithm the token header claims, which is the
 * root of the classic "alg: none" and algorithm-confusion attacks.
 */

const ALGORITHM = "HS256";

const getSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    // Startup validation (config/env.js) normally prevents reaching this.
    throw new Error("JWT_SECRET is not set");
  }

  return secret;
};

/**
 * Create a signed token for a user id. It expires after JWT_EXPIRES_IN
 * (default 24 hours), passed as a number of seconds (see parseDurationSeconds
 * for why it is never passed as a string).
 */
const signToken = (userId) =>
  jwt.sign({ id: String(userId) }, getSecret(), {
    algorithm: ALGORITHM,
    expiresIn: resolveTokenSeconds(process.env.JWT_EXPIRES_IN),
  });

/**
 * Verify a token and return its payload. Throws JsonWebTokenError or
 * TokenExpiredError on failure, exactly like jwt.verify.
 */
const verifyToken = (token) =>
  jwt.verify(token, getSecret(), { algorithms: [ALGORITHM] });

module.exports = { signToken, verifyToken, ALGORITHM };
