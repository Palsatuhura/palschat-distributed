/**
 * Allowed browser origins, shared by Express (cors) and Socket.IO.
 *
 * Set CORS_ORIGINS to a comma-separated list, for example:
 *   CORS_ORIGINS=https://chat.example.com,https://admin.example.com
 *
 * With no value, the usual local development origins are allowed.
 */

const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
];

/**
 * Parse a comma-separated origin list. Whitespace and trailing slashes are
 * removed (browsers send origins without a trailing slash, so "https://a.com/"
 * would otherwise never match).
 */
const parseOrigins = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return [...DEFAULT_ORIGINS];
  }

  return value
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
};

const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS);

module.exports = { allowedOrigins, parseOrigins, DEFAULT_ORIGINS };
