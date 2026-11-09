const { MAX_GROUP_OTHER_MEMBERS } = require("./constants");

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

module.exports = {
  isValidObjectId,
  normalizeParticipantIds,
};
