/**
 * Shared limits and field lists.
 *
 * Keeping these in one place means the REST layer, the socket layer and
 * the Mongoose schemas can all agree on the same numbers.
 */

// Fields of another user that are safe to show to any authenticated user.
// Deliberately excludes email, password and timestamps.
const PUBLIC_USER_FIELDS = "name avatar about isOnline lastSeen";

// Must match the maxlength on Message.text in models/Message.js.
const MAX_MESSAGE_LENGTH = 2000;

const MAX_GROUP_NAME_LENGTH = 50;

// Number of *other* members a group may have (the creator is added on top).
const MAX_GROUP_OTHER_MEMBERS = 49;

// Account field limits.
const MAX_EMAIL_LENGTH = 254; // RFC 5321 limit
const MIN_PASSWORD_LENGTH = 8;
// bcrypt ignores everything after the first 72 bytes of its input.
const MAX_PASSWORD_BYTES = 72;
// Login accepts older, shorter passwords but still bounds the input size.
const MAX_LOGIN_PASSWORD_LENGTH = 128;
const MIN_NAME_LENGTH = 2;

// Profile: the picture is a small data URL (the browser shrinks it to about
// 128x128 before upload); "about" is a short status line.
const MAX_AVATAR_LENGTH = 40000;
const MAX_ABOUT_LENGTH = 140;
const MAX_GROUP_DESCRIPTION_LENGTH = 200;
const MAX_NAME_LENGTH = 50;

// Per-socket event budgets (see utils/eventLimiter.js).
const SOCKET_EVENT_WINDOW_MS = 10 * 1000;
const SOCKET_EVENTS_PER_WINDOW = 100; // all events together
const SOCKET_MESSAGES_PER_WINDOW = 20; // send_message only

module.exports = {
  SOCKET_EVENT_WINDOW_MS,
  SOCKET_EVENTS_PER_WINDOW,
  SOCKET_MESSAGES_PER_WINDOW,
  PUBLIC_USER_FIELDS,
  MAX_MESSAGE_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUP_OTHER_MEMBERS,
  MAX_EMAIL_LENGTH,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  MAX_LOGIN_PASSWORD_LENGTH,
  MIN_NAME_LENGTH,
  MAX_NAME_LENGTH,
  MAX_AVATAR_LENGTH,
  MAX_ABOUT_LENGTH,
  MAX_GROUP_DESCRIPTION_LENGTH,
};
