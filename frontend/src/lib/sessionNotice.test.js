import test from "node:test";
import assert from "node:assert/strict";
import { isSessionProblemCode, getSessionNotice } from "./sessionNotice.js";

test("only the server's session codes count as a session problem", () => {
  for (const code of ["NO_TOKEN", "TOKEN_INVALID", "TOKEN_EXPIRED", "SESSION_ENDED"]) {
    assert.equal(isSessionProblemCode(code), true);
  }
  // a wrong current password is a 401 with no code: must not sign the user out
  assert.equal(isSessionProblemCode(undefined), false);
  assert.equal(isSessionProblemCode("WRONG_PASSWORD"), false);
  assert.equal(isSessionProblemCode(""), false);
});

test("getSessionNotice still handles the ended reason", () => {
  assert.ok(getSessionNotice("ended").length > 0);
  assert.equal(getSessionNotice("<script>"), "");
});

test("getSessionNotice explains a deleted account", () => {
  assert.match(getSessionNotice("deleted"), /deleted/i);
});
