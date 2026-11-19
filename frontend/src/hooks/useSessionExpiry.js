import { useEffect } from "react";
import useAuthStore from "../store/authStore";
import { endSession } from "../lib/session";
import { MAX_TIMEOUT_MS, msUntilExpiry, msUntilRenewal } from "../lib/tokenExpiry";
import { renewSession } from "../lib/renew";

// If a renewal fails (for example no network), try again after this long.
const RENEW_RETRY_MS = 60 * 1000;

/**
 * Signs the user out the moment their login token expires.
 *
 * - On mount: a token that expired while the app was closed is dropped
 *   immediately instead of failing on the first request.
 * - While open: a timer fires at the expiry time.
 * - After sleep or a background tab: browsers delay timers for sleeping
 *   computers and hidden tabs, so the check also runs when the tab becomes
 *   visible or focused again.
 *
 * - Renewal: once a token is half used up, a fresh one is requested for the
 *   same session, so someone who keeps using the app stays signed in (up to
 *   the session's own limit, set on the server).
 *
 * The server enforces expiry independently; this only makes the UI react
 * promptly and with a clear message.
 */
const useSessionExpiry = () => {
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    if (!token) return undefined;

    let timer;

    const check = () => {
      clearTimeout(timer);

      const remaining = msUntilExpiry(token);

      // Tokens without a readable expiry are left to the server to judge.
      if (remaining === null) return;

      if (remaining <= 0) {
        endSession("expired");
        return;
      }

      // Wait for the renewal point, or the expiry, whichever comes first.
      let wait = remaining;
      const untilRenewal = msUntilRenewal(token);
      if (untilRenewal !== null) {
        if (untilRenewal <= 0) {
          renewSession();
          wait = Math.min(remaining, RENEW_RETRY_MS);
        } else {
          wait = Math.min(remaining, untilRenewal);
        }
      }

      // Re-check after at most MAX_TIMEOUT_MS so long lifetimes never
      // overflow setTimeout.
      timer = setTimeout(check, Math.min(wait, MAX_TIMEOUT_MS));
    };

    const onWake = () => {
      if (document.visibilityState !== "hidden") check();
    };

    check();

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [token]);
};

export default useSessionExpiry;
