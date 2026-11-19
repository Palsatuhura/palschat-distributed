/**
 * Unit tests for the pure session helpers (src/utils/sessions.js).
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sessionMaxSeconds,
  tokenSecondsFor,
  shouldTouch,
  describeDevice,
  TOUCH_AFTER_MS,
} = require("../src/utils/sessions");

const DAY = 24 * 60 * 60;

test("sessionMaxSeconds defaults to 30 days and ignores junk", () => {
  assert.equal(sessionMaxSeconds(undefined), 30 * DAY);
  assert.equal(sessionMaxSeconds("7"), 7 * DAY);
  assert.equal(sessionMaxSeconds("0"), 30 * DAY);
  assert.equal(sessionMaxSeconds("abc"), 30 * DAY);
  assert.equal(sessionMaxSeconds("9999"), 30 * DAY);
});

test("tokenSecondsFor never goes past the end of the session", () => {
  const now = Date.now();
  // plenty of session left: the normal token lifetime
  assert.equal(tokenSecondsFor(now + 10 * DAY * 1000, DAY, now), DAY);
  // 2 hours left: only 2 hours
  assert.equal(tokenSecondsFor(now + 2 * 3600 * 1000, DAY, now), 2 * 3600);
  // almost over, or already over: 0 means "sign in again"
  assert.equal(tokenSecondsFor(now + 30 * 1000, DAY, now), 0);
  assert.equal(tokenSecondsFor(now - 1000, DAY, now), 0);
  assert.equal(tokenSecondsFor("not a date", DAY, now), 0);
});

test("shouldTouch only after a few minutes", () => {
  const now = Date.now();
  assert.equal(shouldTouch(now - 1000, now), false);
  assert.equal(shouldTouch(now - TOUCH_AFTER_MS - 1, now), true);
  assert.equal(shouldTouch(undefined, now), true);
});

test("describeDevice names the browser and the system", () => {
  assert.equal(
    describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"),
    "Chrome on Windows"
  );
  assert.equal(
    describeDevice("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0"),
    "Edge on Windows"
  );
  assert.equal(
    describeDevice("Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"),
    "Chrome on Android"
  );
  assert.equal(
    describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"),
    "Safari on iOS"
  );
  assert.equal(
    describeDevice("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"),
    "Chrome on Chromebook"
  );
  assert.equal(describeDevice(undefined), "Unknown device");
  assert.equal(describeDevice(12345), "Unknown device");
  assert.equal(describeDevice("x".repeat(5000)).length < 40, true);
});
