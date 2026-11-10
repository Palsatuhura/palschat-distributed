import { useEffect } from "react";
import useAuthStore from "../store/authStore";
import { endSession } from "../lib/session";
import { MAX_TIMEOUT_MS, msUntilExpiry } from "../lib/tokenExpiry";

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

      // Re-check after at most MAX_TIMEOUT_MS so long lifetimes never
      // overflow setTimeout.
      timer = setTimeout(check, Math.min(remaining, MAX_TIMEOUT_MS));
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
