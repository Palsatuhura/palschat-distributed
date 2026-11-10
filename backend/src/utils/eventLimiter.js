/**
 * Per-socket event rate limiting (fixed window).
 *
 * One limiter instance belongs to one socket, so state lives in memory and
 * disappears when the socket disconnects. No Redis is needed: a socket is
 * always connected to exactly one server.
 *
 * hit() returns:
 *   allowed        true while the socket is within its budget
 *   firstRejection true only for the first rejected event in a window, so the
 *                  caller can warn the client once instead of answering a
 *                  flood with a flood
 *   abusive        true once the socket has sent far more than its budget
 *                  (more than abusiveFactor x max); the caller disconnects it
 */
const createEventLimiter = ({
  max,
  windowMs,
  abusiveFactor = 5,
  now = Date.now,
}) => {
  let windowStart = now();
  let count = 0;

  return {
    hit() {
      const current = now();

      if (current - windowStart >= windowMs) {
        windowStart = current;
        count = 0;
      }

      count += 1;

      return {
        allowed: count <= max,
        firstRejection: count === max + 1,
        abusive: count > max * abusiveFactor,
      };
    },
  };
};

module.exports = { createEventLimiter };
