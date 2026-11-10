import test from "node:test";
import assert from "node:assert/strict";

import { getTokenExpiry, msUntilExpiry, isTokenExpired, MAX_TIMEOUT_MS } from "./tokenExpiry.js";
import { getSessionNotice } from "./sessionNotice.js";

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const tokenWith = (payload) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.signature`;

const NOW = 1_700_000_000_000; // fixed clock for deterministic tests

test("getTokenExpiry reads exp (seconds) as milliseconds", () => {
  assert.equal(getTokenExpiry(tokenWith({ id: "x", exp: 1_700_000_100 })), 1_700_000_100_000);
});

test("getTokenExpiry returns null for tokens without a readable exp", () => {
  const bad = [
    undefined, null, 42, {}, "", "abc", "a.b", "a.b.c.d",
    tokenWith({ id: "x" }),
    tokenWith({ exp: "soon" }),
    tokenWith({ exp: null }),
    tokenWith({ exp: Infinity }), // JSON turns this into null
    "aaa.%%%notbase64%%%.ccc",
    `aaa.${Buffer.from("not json").toString("base64url")}.ccc`,
  ];

  for (const value of bad) {
    assert.equal(getTokenExpiry(value), null, JSON.stringify(value));
  }
});

test("msUntilExpiry is positive before expiry and negative after", () => {
  const token = tokenWith({ exp: NOW / 1000 + 60 });
  assert.equal(msUntilExpiry(token, NOW), 60_000);
  assert.equal(msUntilExpiry(token, NOW + 90_000), -30_000);
  assert.equal(msUntilExpiry("garbage", NOW), null);
});

test("isTokenExpired is true at and after expiry, false before", () => {
  const token = tokenWith({ exp: NOW / 1000 });
  assert.equal(isTokenExpired(token, NOW - 1), false);
  assert.equal(isTokenExpired(token, NOW), true);
  assert.equal(isTokenExpired(token, NOW + 1), true);
});

test("isTokenExpired leaves unreadable tokens to the server (false)", () => {
  assert.equal(isTokenExpired("garbage", NOW), false);
  assert.equal(isTokenExpired(undefined, NOW), false);
  assert.equal(isTokenExpired(tokenWith({ id: "x" }), NOW), false);
});

test("MAX_TIMEOUT_MS matches the setTimeout limit", () => {
  assert.equal(MAX_TIMEOUT_MS, 2147483647);
});

test("getSessionNotice only produces text for known reasons", () => {
  assert.match(getSessionNotice("expired"), /expired/i);
  assert.match(getSessionNotice("invalid"), /no longer valid/i);

  for (const reason of [null, undefined, "", "other", "EXPIRED", "constructor", "__proto__", "<script>alert(1)</script>"]) {
    assert.equal(getSessionNotice(reason), "", JSON.stringify(reason));
  }
});
