import test from "node:test";
import assert from "node:assert/strict";
import { genderOf, defaultAvatarKind, isGender } from "./gender.js";

test("genderOf falls back to unspecified", () => {
  assert.equal(genderOf({ gender: "male" }), "male");
  assert.equal(genderOf({ gender: "female" }), "female");
  assert.equal(genderOf({}), "unspecified");
  assert.equal(genderOf(null), "unspecified");
  assert.equal(genderOf({ gender: "robot" }), "unspecified");
  assert.equal(isGender("male"), true);
  assert.equal(isGender("x"), false);
});

test("deleted users get the neutral icon", () => {
  assert.equal(defaultAvatarKind({ gender: "female", deletedAt: "2026-01-01" }), "unspecified");
  assert.equal(defaultAvatarKind({ gender: "female" }), "female");
});
