/**
 * Unit tests for the profile validators (npm test).
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { validateAvatar, validateAbout } = require("../src/utils/validators");
const { MAX_AVATAR_LENGTH, MAX_ABOUT_LENGTH } = require("../src/utils/constants");

const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 1)]);
const webpBytes = Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP"), Buffer.alloc(40, 1),
]);
const url = (type, bytes) => `data:image/${type};base64,${bytes.toString("base64")}`;

test("validateAvatar accepts real JPEG, PNG and WebP data", () => {
  assert.ok(validateAvatar(url("jpeg", jpegBytes)).avatar);
  assert.ok(validateAvatar(url("png", pngBytes)).avatar);
  assert.ok(validateAvatar(url("webp", webpBytes)).avatar);
});

test("validateAvatar: empty string removes the picture", () => {
  assert.deepEqual(validateAvatar(""), { avatar: "" });
});

test("validateAvatar rejects wrong types, fake images and links", () => {
  assert.ok(validateAvatar(123).error);
  assert.ok(validateAvatar("https://example.com/a.png").error);
  assert.ok(validateAvatar("data:text/html;base64,PHNjcmlwdD4=").error);
  assert.ok(validateAvatar("data:image/svg+xml;base64,PHN2Zz4=").error);
  assert.ok(validateAvatar("javascript:alert(1)").error);
  // declared JPEG but the bytes are a PNG
  assert.ok(validateAvatar(url("jpeg", pngBytes)).error);
  // not base64
  assert.ok(validateAvatar("data:image/jpeg;base64,@@@@").error);
});

test("validateAvatar rejects pictures over the size limit", () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_AVATAR_LENGTH)]);
  assert.ok(validateAvatar(url("jpeg", big)).error);
});

test("validateAbout trims, allows empty, and caps the length", () => {
  assert.deepEqual(validateAbout("  hello  "), { about: "hello" });
  assert.deepEqual(validateAbout(""), { about: "" });
  assert.ok(validateAbout("x".repeat(MAX_ABOUT_LENGTH + 1)).error);
  assert.ok(validateAbout(5).error);
  assert.ok(validateAbout({ $ne: null }).error);
});
