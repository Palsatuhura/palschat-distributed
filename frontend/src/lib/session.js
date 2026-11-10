import socket from "./socket";
import useAuthStore from "../store/authStore";

let ending = false;

/**
 * End the current session and send the user to the login page.
 *
 * Used whenever the server or the clock says the login token is no longer
 * good: an expired token on startup, a 401 from the API, a rejected socket
 * handshake, or the server closing the socket at expiry.
 *
 * It reloads the page on purpose. That drops every in-memory copy of the
 * previous user's conversations and messages, which matters on a shared
 * computer.
 *
 * @param {"expired" | "invalid"} reason shown on the login page
 */
export const endSession = (reason = "expired") => {
  // Several things can notice expiry at the same moment (REST call, socket,
  // timer); only the first one should act.
  if (ending) return;
  ending = true;

  // Stop Socket.IO retrying with the dead token while the page unloads.
  socket.io.opts.reconnection = false;
  socket.auth = {};
  socket.disconnect();

  useAuthStore.getState().logout();

  window.location.assign(`/login?reason=${encodeURIComponent(reason)}`);
};
