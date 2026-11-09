/**
 * Shared limits and field lists.
 *
 * Keeping these in one place means the REST layer, the socket layer and
 * the Mongoose schemas can all agree on the same numbers.
 */

// Fields of another user that are safe to show to any authenticated user.
// Deliberately excludes email, password and timestamps.
const PUBLIC_USER_FIELDS = "name avatar isOnline lastSeen";

// Must match the maxlength on Message.text in models/Message.js.
const MAX_MESSAGE_LENGTH = 2000;

const MAX_GROUP_NAME_LENGTH = 50;

// Number of *other* members a group may have (the creator is added on top).
const MAX_GROUP_OTHER_MEMBERS = 49;

module.exports = {
  PUBLIC_USER_FIELDS,
  MAX_MESSAGE_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUP_OTHER_MEMBERS,
};
