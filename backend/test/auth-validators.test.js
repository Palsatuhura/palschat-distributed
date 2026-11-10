const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeEmail,
  validateNewPassword,
  validateName,
} = require("../src/utils/validators");

test("normalizeEmail trims and lower-cases valid addresses", () => {
  assert.equal(normalizeEmail("  Alice@Example.COM "), "alice@example.com");
  assert.equal(normalizeEmail("a.b+tag@sub.domain.org"), "a.b+tag@sub.domain.org");
});

test("normalizeEmail rejects non-strings (NoSQL operator injection)", () => {
  for (const value of [undefined, null, 5, true, [], ["a@b.co"], { $ne: null }, { $gt: "" }]) {
    assert.equal(normalizeEmail(value), null, `should reject ${JSON.stringify(value)}`);
  }
});

test("normalizeEmail rejects malformed or oversized addresses", () => {
  const bad = ["", "   ", "plain", "a@b", "a@@b.co", "a b@c.co", "@b.co", "a@.co", "a@b.", `${"x".repeat(250)}@b.co`];
  for (const value of bad) {
    assert.equal(normalizeEmail(value), null, `should reject ${JSON.stringify(value)}`);
  }
});

test("validateNewPassword enforces 8 characters minimum", () => {
  assert.ok(validateNewPassword("short7!"));
  assert.equal(validateNewPassword("exactly8"), null);
});

test("validateNewPassword rejects non-strings", () => {
  for (const value of [undefined, null, 12345678, {}, ["password1"]]) {
    assert.ok(validateNewPassword(value), `should reject ${JSON.stringify(value)}`);
  }
});

test("validateNewPassword enforces bcrypt's 72-BYTE limit, not 72 characters", () => {
  assert.equal(validateNewPassword("a".repeat(72)), null);
  assert.ok(validateNewPassword("a".repeat(73)));

  // 36 two-byte characters = 72 bytes (ok); 37 = 74 bytes (too long)
  assert.equal(validateNewPassword("é".repeat(36)), null);
  assert.ok(validateNewPassword("é".repeat(37)));
});

test("validateName trims and enforces length", () => {
  assert.deepEqual(validateName("  Alice  "), { name: "Alice" });
  assert.ok(validateName("A").error);
  assert.ok(validateName("   ").error);
  assert.ok(validateName("x".repeat(51)).error);
  assert.equal(validateName("x".repeat(50)).name.length, 50);
});

test("validateName rejects non-strings", () => {
  for (const value of [undefined, null, 5, {}, ["Alice"]]) {
    assert.ok(validateName(value).error, `should reject ${JSON.stringify(value)}`);
  }
});
