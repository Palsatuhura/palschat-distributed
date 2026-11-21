const {
  MAX_GROUP_OTHER_MEMBERS,
  MAX_EMAIL_LENGTH,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  MIN_NAME_LENGTH,
  MAX_NAME_LENGTH,
  MAX_AVATAR_LENGTH,
  MAX_ABOUT_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUP_DESCRIPTION_LENGTH,
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
 * Validate a profile picture. The picture is a data URL such as
 * "data:image/jpeg;base64,/9j/4AAQ...". An empty string removes the picture.
 * Returns { avatar } or { error }.
 *
 * Besides the declared type, the first bytes of the decoded data must match
 * a real JPEG, PNG or WebP file, so arbitrary data cannot be stored as an
 * "image". The browser only ever puts it in an <img> tag.
 */
const AVATAR_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

const validateAvatar = (value) => {
  if (typeof value !== "string") return { error: "Picture must be a string" };
  if (value === "") return { avatar: "" };
  if (value.length > MAX_AVATAR_LENGTH) {
    return { error: "Picture is too large. Choose a smaller image." };
  }

  const match = AVATAR_PATTERN.exec(value);
  if (!match) return { error: "Picture must be a JPEG, PNG or WebP image" };

  const head = Buffer.from(match[2].slice(0, 24), "base64");
  const isJpeg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng =
    head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isWebp =
    head.length >= 12 &&
    head.toString("ascii", 0, 4) === "RIFF" &&
    head.toString("ascii", 8, 12) === "WEBP";
  const declared = match[1];

  const ok =
    (declared === "jpeg" && isJpeg) ||
    (declared === "png" && isPng) ||
    (declared === "webp" && isWebp);
  if (!ok) return { error: "Picture data is not a valid image" };

  return { avatar: value };
};

/**
 * Validate the "about" line. Returns { about } (trimmed) or { error }.
 */
const validateAbout = (value) => {
  if (typeof value !== "string") return { error: "About must be a string" };
  const about = value.trim();
  if (about.length > MAX_ABOUT_LENGTH) {
    return { error: `About cannot exceed ${MAX_ABOUT_LENGTH} characters` };
  }
  return { about };
};

/**
 * Validate the gender choice. Returns { gender } or { error }.
 * Only used to pick the default profile picture.
 */
const GENDERS = ["male", "female", "unspecified"];
const validateGender = (value) => {
  if (typeof value !== "string" || !GENDERS.includes(value)) {
    return { error: "Please choose male, female or prefer not to say" };
  }
  return { gender: value };
};

/**
 * Gender is set once: allowed when nothing was chosen yet, or when the new
 * value is the same as the current one (no change).
 */
const canSetGender = (current, next) =>
  current === next || !current || current === "unspecified";

/**
 * Validate a group name. Returns { groupName } (trimmed) or { error }.
 */
const validateGroupName = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return { error: "Group name is required" };
  }
  const groupName = value.trim();
  if (groupName.length > MAX_GROUP_NAME_LENGTH) {
    return { error: `Group name cannot exceed ${MAX_GROUP_NAME_LENGTH} characters` };
  }
  return { groupName };
};

/**
 * Validate a group description. Returns { groupDescription } or { error }.
 */
const validateGroupDescription = (value) => {
  if (typeof value !== "string") return { error: "Description must be a string" };
  const groupDescription = value.trim();
  if (groupDescription.length > MAX_GROUP_DESCRIPTION_LENGTH) {
    return { error: `Description cannot exceed ${MAX_GROUP_DESCRIPTION_LENGTH} characters` };
  }
  return { groupDescription };
};

/**
 * Stable key for a one-to-one conversation: the two user ids, lower-cased and
 * sorted, so (A,B) and (B,A) give the same key. A unique database index on it
 * stops two simultaneous requests from creating two DMs for the same pair.
 */
const dmKeyFor = (idA, idB) =>
  [String(idA).toLowerCase(), String(idB).toLowerCase()].sort().join(":");

module.exports = {
  validateGroupName,
  validateGroupDescription,
  validateAvatar,
  validateAbout,
  validateGender,
  canSetGender,
  dmKeyFor,
  isValidObjectId,
  normalizeParticipantIds,
  normalizeEmail,
  validateNewPassword,
  validateName,
};
