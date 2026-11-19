import test from "node:test";
import assert from "node:assert/strict";

import { msUntilRenewal } from "./tokenExpiry.js";
import { getSessionNotice } from "./sessionNotice.js";

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const tokenWith = (payload) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.signature`;

const NOW = 1_700_000_000_000;
const sec = (ms) => Math.floor(ms / 1000);

test("msUntilRenewal is the time until the token is half used up", () => {
  // issued now, lasts 24 hours: renew in 12 hours
  const t = tokenWith({ iat: sec(NOW), exp: sec(NOW) + 24 * 3600 });
  assert.equal(msUntilRenewal(t, NOW), 12 * 3600 * 1000);
  // 13 hours later: past the half-way point, so renewal is due (negative)
  assert.ok(msUntilRenewal(t, NOW + 13 * 3600 * 1000) < 0);
});

test("msUntilRenewal gives null when issue or expiry time is unreadable", () => {
  assert.equal(msUntilRenewal(tokenWith({ exp: sec(NOW) + 100 }), NOW), null);
  assert.equal(msUntilRenewal(tokenWith({ iat: sec(NOW) }), NOW), null);
  assert.equal(msUntilRenewal(tokenWith({ iat: sec(NOW) + 50, exp: sec(NOW) }), NOW), null);
  assert.equal(msUntilRenewal("nope", NOW), null);
  assert.equal(msUntilRenewal(undefined, NOW), null);
});

test("a login that was ended elsewhere has its own message", () => {
  assert.ok(getSessionNotice("ended").length > 0);
  assert.equal(getSessionNotice("<script>"), "");
});
