const {
  MAX_GROUP_OTHER_MEMBERS,
  MAX_EMAIL_LENGTH,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  MIN_NAME_LENGTH,
  MAX_NAME_LENGTH,
} = require("./constants");

// Deliberately simple: the real proof of ownership is sending mail to it.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Input validation helpers.
 *
 * Everything that arrives from a client (JSON body, query string, socket
 * payload) is untrusted. These helpers are intentionally strict and have no
 * dependency on Mongoose or the database, so they are cheap to unit test.
 */

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * True only for a 24-character hex *string*.
 *
 * Rejects objects such as { $ne: null } (NoSQL operator injection), numbers,
 * arrays, and the 12-character strings that Mongoose would otherwise accept
 * as ObjectIds.
 */
const isValidObjectId = (value) =>
  typeof value === "string" && OBJECT_ID_PATTERN.test(value);

/**
 * Normalize a client-supplied list of participant IDs for a group chat.
 *
 * - must be an array of valid ObjectId strings
 * - duplicates are collapsed
 * - the requesting user is removed (they are added by the server)
 * - the number of other members is capped
 *
 * Returns { ids } on success or { error } with a message safe to show.
 */
const normalizeParticipantIds = (input, selfId) => {
  if (!Array.isArray(input)) {
    return { error: "participantIds must be an array of user IDs" };
  }

  const self = String(selfId).toLowerCase();
  const unique = new Set();

  for (const value of input) {
    if (!isValidObjectId(value)) {
      return { error: "participantIds must only contain valid user IDs" };
    }

    const id = value.toLowerCase();

    if (id !== self) {
      unique.add(id);
    }

    // Stop early so a huge array cannot make us loop over everything.
    if (unique.size > MAX_GROUP_OTHER_MEMBERS) {
      return {
        error: `A group can have at most ${MAX_GROUP_OTHER_MEMBERS + 1} members`,
      };
    }
  }

  return { ids: [...unique] };
};

/**
 * Normalize an email address: must be a string, trimmed, lower-cased, no
 * longer than the RFC limit and shaped like name@host.tld.
 *
 * Returns the normalized address, or null if it is not acceptable. Because it
 * returns a plain string, the value is safe to use in a database query
 * (an object such as { $ne: null } can never get through).
 */
const normalizeEmail = (value) => {
  if (typeof value !== "string") return null;

  const email = value.trim().toLowerCase();

  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_PATTERN.test(email)) return null;

  return email;
};

/**
 * Validate a NEW password (registration).
 *
 * bcrypt only uses the first 72 BYTES of its input, so a longer password
 * would be silently truncated; reject it instead. The upper bound also stops
 * oversized inputs being fed to the hashing function.
 *
 * Returns an error message, or null if the password is acceptable.
 */
const validateNewPassword = (value) => {
  if (typeof value !== "string") return "Password must be a string";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(value, "utf8") > MAX_PASSWORD_BYTES) {
    return `Password is too long (maximum ${MAX_PASSWORD_BYTES} bytes)`;
  }
  return null;
};

/**
 * Validate a display name. Returns { name } (trimmed) or { error }.
 */
const validateName = (value) => {
  if (typeof value !== "string") return { error: "Name must be a string" };

  const name = value.trim();

  if (name.length < MIN_NAME_LENGTH) {
    return { error: `Name must be at least ${MIN_NAME_LENGTH} characters` };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { error: `Name cannot exceed ${MAX_NAME_LENGTH} characters` };
  }

  return { name };
};

/**
 * Stable key for a one-to-one conversation: the two user ids, lower-cased and
 * sorted, so (A,B) and (B,A) give the same key. A unique database index on it
 * stops two simultaneous requests from creating two DMs for the same pair.
 */
const dmKeyFor = (idA, idB) =>
  [String(idA).toLowerCase(), String(idB).toLowerCase()].sort().join(":");

module.exports = {
  dmKeyFor,
  isValidObjectId,
  normalizeParticipantIds,
  normalizeEmail,
  validateNewPassword,
  validateName,
};
