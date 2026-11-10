/**
 * The message shown on the login page after a session ended on its own.
 *
 * The reason arrives in the URL (/login?reason=expired), so it is treated as
 * untrusted: only the exact values below produce text, anything else is
 * ignored.
 */
export const getSessionNotice = (reason) => {
  switch (reason) {
    case "expired":
      return "Your session expired. Please sign in again.";
    case "invalid":
      return "Your session is no longer valid. Please sign in again.";
    default:
      return "";
  }
};
