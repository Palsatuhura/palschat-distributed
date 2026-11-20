import test from "node:test";
import assert from "node:assert/strict";
import { dayLabel, isSameDay } from "./dayLabel.js";

const now = new Date(2026, 10, 20, 15, 0); // 20 Nov 2026, 3pm local

test("today and yesterday, whatever the time of day", () => {
  assert.equal(dayLabel(new Date(2026, 10, 20, 0, 5), now), "Today");
  assert.equal(dayLabel(new Date(2026, 10, 19, 23, 59), now), "Yesterday");
});

test("older messages get a weekday, then a date", () => {
  const weekday = dayLabel(new Date(2026, 10, 17, 9, 0), now);
  assert.ok(weekday.length > 3 && !/\d/.test(weekday), weekday);
  const older = dayLabel(new Date(2026, 9, 1, 9, 0), now);
  assert.match(older, /1/);
  assert.doesNotMatch(older, /2026/); // same year: no year shown
  assert.match(dayLabel(new Date(2025, 11, 25, 9, 0), now), /2025/);
});

test("bad dates give an empty label; isSameDay compares calendar days", () => {
  assert.equal(dayLabel("not a date", now), "");
  assert.equal(isSameDay(new Date(2026, 10, 20, 1), new Date(2026, 10, 20, 23)), true);
  assert.equal(isSameDay(new Date(2026, 10, 20, 23), new Date(2026, 10, 21, 0, 1)), false);
});
