import { io } from "socket.io-client";

/**
 * Socket.IO client singleton.
 *
 * The socket is created once and reused for the entire authenticated
 * session.
 *
 * Reconnection is enabled so temporary network interruptions do not
 * permanently break the chat connection.
 */
const socket = io(import.meta.env.VITE_SOCKET_URL, {
  autoConnect: false,

  // WebSocket only. With several servers behind a load balancer, the
  // long-polling fallback needs sticky sessions (every request of one client
  // must reach the same server). A WebSocket is one connection, so it does not.
  transports: ["websocket"],

  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,

  timeout: 10000,
});

export default socket;
