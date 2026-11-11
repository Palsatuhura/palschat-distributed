/**
 * Helpers for paging through message history.
 *
 * History is served NEWEST FIRST from the database (so the first page is the
 * latest messages) and then flipped to oldest-first for display. To get the
 * page before the one you already have, send the id of the oldest message you
 * hold as `before`. A cursor like this stays correct while new messages
 * arrive, which "page=2" does not: every new message shifts the pages.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * Turn the untrusted ?limit= value into a safe page size (1..100).
 * Anything that is not a positive whole number falls back to the default.
 */
const parseLimit = (raw) => {
  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value < 1) return DEFAULT_PAGE_SIZE;

  return Math.min(value, MAX_PAGE_SIZE);
};

/**
 * Mongo filter for "strictly older than this message". Messages created in
 * the same millisecond are ordered by _id, so none is skipped or repeated.
 */
const olderThanFilter = (cursor) => ({
  $or: [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
  ],
});

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseLimit,
  olderThanFilter,
};
