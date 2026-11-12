/**
 * Give up on a promise that takes too long.
 *
 * A Redis command on a connection that has silently died never fails and
 * never finishes; it just waits. Without a time limit, everything that awaits
 * it (a login, a message) waits forever too. This turns "never" into an error
 * the caller can handle.
 *
 * Note: the underlying operation is NOT cancelled, only no longer waited for.
 */
const withTimeout = (promise, ms, label = "operation") =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms} ms`));
    }, ms);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

module.exports = { withTimeout };
