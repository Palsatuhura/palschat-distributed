/**
 * The message shown on the login page after a session ended on its own.
 *
 * The reason arrives in the URL (/login?reason=expired), so it is treated as
 * untrusted: only the exact values below produce text, anything else is
 * ignored.
 */
/**
 * True when a 401 response carries one of the server's session codes, meaning
 * "this login is no longer good". A 401 without such a code (for example a
 * wrong current password on the change-password form) must NOT sign the user
 * out.
 */
export const SESSION_CODES = ["NO_TOKEN", "TOKEN_INVALID", "TOKEN_EXPIRED", "SESSION_ENDED"];
export const isSessionProblemCode = (code) => SESSION_CODES.includes(code);

export const getSessionNotice = (reason) => {
  switch (reason) {
    case "expired":
      return "Your session expired. Please sign in again.";
    case "ended":
      return "This login was ended. Please sign in again.";
    case "deleted":
      return "Your account was deleted.";
    case "invalid":
      return "Your session is no longer valid. Please sign in again.";
    default:
      return "";
  }
};
