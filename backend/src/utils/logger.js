/**
 * Tiny logger. Routine events (who connected, which message was sent) are
 * only printed when LOG_LEVEL=debug, so production logs stay short and do not
 * fill up with user ids. Warnings and errors are always printed.
 */
const debugOn = () => process.env.LOG_LEVEL === "debug";

module.exports = {
  debug: (...args) => debugOn() && console.log(...args),
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
