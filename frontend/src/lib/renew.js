import api from "./axios";
import socket from "./socket";
import useAuthStore from "../store/authStore";

let inFlight = null;

/**
 * Asks the server for a fresh login token for the SAME session and swaps it
 * in, without reconnecting the chat.
 *
 * - A 401 (the session was ended) is handled by the axios interceptor, which
 *   signs the user out with a message.
 * - A network failure is ignored here; the caller tries again shortly, and
 *   the old token keeps working until it really expires.
 * - Several callers at once share one request.
 */
export const renewSession = () => {
  if (inFlight) return inFlight;

  inFlight = api
    .post("/auth/refresh")
    .then(({ data }) => {
      if (!data || typeof data.token !== "string") return;

      // The socket must learn about the new token too, or the server would
      // close it at the old expiry.
      socket.auth = { token: data.token };
      if (socket.connected) socket.emit("renew_token", { token: data.token });

      useAuthStore.getState().setToken(data.token);
    })
    .catch(() => {})
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};
