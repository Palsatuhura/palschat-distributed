import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTheme, normalizeAccent, isDark, THEMES, ACCENTS } from "./theme.js";

test("unknown theme and accent values fall back to the defaults", () => {
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("neon"), "system");
  assert.equal(normalizeTheme(null), "system");
  assert.equal(normalizeAccent("rose"), "rose");
  assert.equal(normalizeAccent("<script>"), "blue");
  assert.equal(normalizeAccent(undefined), "blue");
  assert.deepEqual(THEMES, ["light", "dark", "system"]);
  assert.ok(ACCENTS.includes("blue"));
});

test("isDark: explicit choices win, system follows the device", () => {
  assert.equal(isDark("dark", false), true);
  assert.equal(isDark("light", true), false);
  assert.equal(isDark("system", true), true);
  assert.equal(isDark("system", false), false);
  assert.equal(isDark("garbage", true), true); // unknown behaves like system
});
