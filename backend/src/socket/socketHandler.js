const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const { verifyToken } = require("../utils/jwt");
const { createEventLimiter } = require("../utils/eventLimiter");
const { isValidObjectId } = require("../utils/validators");
const {
  MAX_MESSAGE_LENGTH,
  SOCKET_EVENT_WINDOW_MS,
  SOCKET_EVENTS_PER_WINDOW,
  SOCKET_MESSAGES_PER_WINDOW,
} = require("../utils/constants");

/*
 * Distributed presence architecture
 *
 * Each user's active sockets are stored in Redis:
 *
 *   presence:user:<userId>
 *       ├── socket-id-1
 *       ├── socket-id-2
 *       └── socket-id-3
 *
 * A global Redis Set keeps track of users who currently have
 * at least one active socket:
 *
 *   presence:online-users
 */

const socketHandler = (io, presenceClient) => {
  const getUserRoom = (userId) => `user:${userId}`;

  const getPresenceKey = (userId) =>
    `presence:user:${userId}`;

  const ONLINE_USERS_KEY = "presence:online-users";

  /*
   * ─── Authorization helpers ──────────────────────────────────────────────
   *
   * Every event that names a conversation must be checked, because the
   * client controls the conversation id. Authenticating the socket only
   * proves WHO the user is, not WHAT they may access.
   */

  // Authoritative check: is this user a participant of the conversation?
  const canAccessConversation = async (conversationId, userId) => {
    if (!isValidObjectId(conversationId)) return false;

    const found = await Conversation.exists({
      _id: conversationId,
      participants: userId,
    });

    return Boolean(found);
  };

  // Cheap check for high-frequency events (typing): a socket can only be in
  // a conversation room if canAccessConversation passed in join_conversation.
  const hasJoinedConversation = (socket, conversationId) =>
    isValidObjectId(conversationId) && socket.rooms.has(conversationId);

  const rejectEvent = (socket, message) => {
    socket.emit("error", { message });
  };

  // Socket.IO delivers `err.data` to the client's connect_error handler, so
  // the browser can tell "expired" from "invalid" without parsing messages.
  const authError = (message, code) => {
    const error = new Error(message);
    error.data = { code };
    return error;
  };

  // setTimeout silently misbehaves above 2^31-1 ms (about 24.8 days) and
  // fires immediately, so longer waits are not scheduled at all.
  const MAX_TIMER_MS = 2 ** 31 - 1;

  /*
   * Remove a socket from Redis presence.
   *
   * If that was the user's final socket, mark the user offline.
   */
  const removeSocketPresence = async (userId, socketId) => {
    if (!userId || !socketId) return;

    const presenceKey = getPresenceKey(userId);

    try {
      await presenceClient.sRem(
        presenceKey,
        socketId
      );

      const remainingSockets =
        await presenceClient.sCard(
          presenceKey
        );

      if (remainingSockets === 0) {
        await presenceClient.del(
          presenceKey
        );

        await presenceClient.sRem(
          ONLINE_USERS_KEY,
          userId
        );

        const lastSeen = new Date();

        await User.findByIdAndUpdate(
          userId,
          {
            isOnline: false,
            lastSeen,
          }
        );

        io.emit("user_offline", {
          userId,
          lastSeen,
        });

        console.log(
          `🔴 User became offline: ${userId}`
        );
      } else {
        console.log(
          `🟢 User ${userId} still has ${remainingSockets} active socket(s)`
        );
      }
    } catch (error) {
      console.error(
        "Redis presence cleanup error:",
        error
      );
    }
  };

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token;

      if (!token || typeof token !== "string") {
        return next(
          authError(
            "Authentication required",
            "NO_TOKEN"
          )
        );
      }

      // Algorithm is pinned in utils/jwt.js.
      const decoded = verifyToken(token);

      if (!isValidObjectId(decoded.id)) {
        return next(
          authError(
            "Invalid or expired authentication token",
            "TOKEN_INVALID"
          )
        );
      }

      const user =
        await User.findById(decoded.id)
          .select("-password");

      if (!user) {
        return next(
          authError(
            "User no longer exists",
            "TOKEN_INVALID"
          )
        );
      }

      socket.userId =
        user._id.toString();

      socket.user = user;

      // When this login token expires (ms since epoch). A socket that stays
      // connected must not outlive the token that authenticated it.
      socket.tokenExpiresAt =
        typeof decoded.exp === "number"
          ? decoded.exp * 1000
          : null;

      next();
    } catch (error) {
      console.error(
        "Socket authentication failed:",
        error.message
      );

      next(
        authError(
          "Invalid or expired authentication token",
          error.name === "TokenExpiredError"
            ? "TOKEN_EXPIRED"
            : "TOKEN_INVALID"
        )
      );
    }
  });

  io.on("connection", async (socket) => {
    console.log(
      `🔐 Authenticated socket connected: ${socket.id}`
    );

    console.log(
      `👤 User: ${socket.user.name} (${socket.userId})`
    );

    const userId = socket.userId;
    const userRoom = getUserRoom(userId);
    const presenceKey =
      getPresenceKey(userId);

    /*
     * End the session when the login token expires. Without this, a socket
     * connected with a valid token would keep working for as long as the
     * connection stays open, long after the token itself had expired.
     */
    let expiryTimer = null;

    if (socket.tokenExpiresAt) {
      const msUntilExpiry =
        socket.tokenExpiresAt - Date.now();

      if (msUntilExpiry <= MAX_TIMER_MS) {
        expiryTimer = setTimeout(
          () => {
            console.log(
              `⏰ Token expired, closing socket ${socket.id} (user ${socket.userId})`
            );

            socket.emit(
              "session_expired",
              { code: "TOKEN_EXPIRED" }
            );

            socket.disconnect(true);
          },
          Math.max(msUntilExpiry, 0)
        );
      }
    }

    /*
     * Flood protection. socket.use() runs before every event handler, so a
     * client that sends events in a tight loop is throttled before any
     * database work happens. Rejected events are dropped, not queued.
     */
    const eventLimiter = createEventLimiter({
      max: SOCKET_EVENTS_PER_WINDOW,
      windowMs: SOCKET_EVENT_WINDOW_MS,
    });

    const messageLimiter = createEventLimiter({
      max: SOCKET_MESSAGES_PER_WINDOW,
      windowMs: SOCKET_EVENT_WINDOW_MS,
    });

    socket.use((packet, next) => {
      const [event, ...args] = packet;

      const overall = eventLimiter.hit();
      const messages =
        event === "send_message"
          ? messageLimiter.hit()
          : { allowed: true, firstRejection: false };

      if (overall.allowed && messages.allowed) {
        return next();
      }

      // Tell the client, but only once per window: answering every dropped
      // event would let a flood trigger an equal flood of replies.
      if (overall.firstRejection || messages.firstRejection) {
        rejectEvent(
          socket,
          "You are sending too many requests. Please slow down."
        );
      }

      // A client waiting on an acknowledgement should not hang.
      const ack = args[args.length - 1];
      if (typeof ack === "function") {
        ack({
          ok: false,
          message: "You are sending too many requests. Please slow down.",
        });
      }

      // `socket.connected` guards against logging and disconnecting again for
      // every event still queued behind the one that tripped the limit.
      if (overall.abusive && socket.connected) {
        console.warn(
          `🚫 Disconnecting socket ${socket.id} (user ${socket.userId}) for flooding`
        );
        socket.disconnect(true);
      }

      // Not calling next(): the event is dropped.
    });

    /*
     * IMPORTANT: register every socket.on(...) handler synchronously,
     * BEFORE the first await in this callback.
     *
     * Socket.IO drops any event that arrives while no listener is attached.
     * The presence setup at the bottom of this callback makes several
     * sequential calls to Redis and MongoDB; if the handlers were registered
     * after it, an event sent right after "connect" (such as the client's
     * join_conversation) would be silently lost.
     */

    socket.on(
      "join_conversation",
      async (conversationId, ack) => {
        // `ack` is optional: clients that do not pass a callback still work.
        const respond = (payload) => {
          if (typeof ack === "function") ack(payload);
        };

        try {
          const allowed =
            await canAccessConversation(
              conversationId,
              socket.userId
            );

          if (!allowed) {
            console.warn(
              `🚫 User ${socket.userId} denied access to room: ${String(conversationId).slice(0, 40)}`
            );

            rejectEvent(
              socket,
              "You are not a participant of this conversation"
            );

            respond({
              ok: false,
              message:
                "You are not a participant of this conversation",
            });

            return;
          }

          socket.join(conversationId);

          console.log(
            `📨 Socket ${socket.id} joined room: ${conversationId}`
          );

          respond({ ok: true });
        } catch (error) {
          console.error(
            "join_conversation error:",
            error
          );

          rejectEvent(
            socket,
            "Failed to join conversation"
          );

          respond({
            ok: false,
            message: "Failed to join conversation",
          });
        }
      }
    );

    socket.on(
      "leave_conversation",
      (conversationId) => {
        // Only real conversation ids: never let a client leave its own
        // private user room or socket room by passing those names.
        if (!isValidObjectId(conversationId)) return;

        socket.leave(conversationId);

        console.log(
          `📤 Socket ${socket.id} left room: ${conversationId}`
        );
      }
    );

    socket.on(
      "send_message",
      async (data) => {
        try {
          // The payload is untrusted: it may be missing, or any type.
          const conversationId =
            data?.conversationId;

          const text = data?.text;

          // Always the authenticated user, never a client-supplied id.
          const senderId =
            socket.userId;

          if (
            !isValidObjectId(
              conversationId
            ) ||
            typeof text !== "string" ||
            !text.trim()
          ) {
            rejectEvent(
              socket,
              "Invalid message data"
            );

            return;
          }

          if (
            text.trim().length >
            MAX_MESSAGE_LENGTH
          ) {
            rejectEvent(
              socket,
              `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`
            );

            return;
          }

          // Authorization: only participants may post into a conversation.
          const allowed =
            await canAccessConversation(
              conversationId,
              senderId
            );

          if (!allowed) {
            console.warn(
              `🚫 User ${senderId} tried to post to conversation ${conversationId} without being a participant`
            );

            rejectEvent(
              socket,
              "You are not a participant of this conversation"
            );

            return;
          }

          const message =
            await Message.create({
              conversation:
                conversationId,
              sender: senderId,
              text: text.trim(),
              readBy: [senderId],
            });

          await message.populate(
            "sender",
            "name avatar"
          );

          await Conversation.findByIdAndUpdate(
            conversationId,
            {
              lastMessage:
                message._id,
              updatedAt:
                new Date(),
            }
          );

          io.to(conversationId).emit(
            "receive_message",
            message
          );

          console.log(
            `💬 Message sent in room ${conversationId} by ${senderId}`
          );
        } catch (error) {
          console.error(
            "send_message error:",
            error
          );

          rejectEvent(
            socket,
            "Failed to send message"
          );
        }
      }
    );

    socket.on(
      "typing",
      (data) => {
        // `data` is client-controlled and may be undefined; reading a
        // property of undefined inside an event handler would throw.
        const conversationId =
          data?.conversationId;

        if (
          !hasJoinedConversation(
            socket,
            conversationId
          )
        ) {
          return;
        }

        socket
          .to(conversationId)
          .emit("typing", {
            userId:
              socket.userId,
            userName:
              socket.user.name,
            conversationId,
          });
      }
    );

    socket.on(
      "stop_typing",
      (data) => {
        const conversationId =
          data?.conversationId;

        if (
          !hasJoinedConversation(
            socket,
            conversationId
          )
        ) {
          return;
        }

        socket
          .to(conversationId)
          .emit("stop_typing", {
            userId:
              socket.userId,
            conversationId,
          });
      }
    );

    socket.on(
      "mark_read",
      async (data) => {
        try {
          const conversationId =
            data?.conversationId;

          const authenticatedUserId =
            socket.userId;

          // Only participants may mark messages as read.
          const allowed =
            await canAccessConversation(
              conversationId,
              authenticatedUserId
            );

          if (!allowed) {
            return;
          }

          await Message.updateMany(
            {
              conversation:
                conversationId,
              readBy: {
                $ne:
                  authenticatedUserId,
              },
              sender: {
                $ne:
                  authenticatedUserId,
              },
            },
            {
              $addToSet: {
                readBy:
                  authenticatedUserId,
              },
            }
          );

          socket
            .to(conversationId)
            .emit(
              "messages_read",
              {
                conversationId,
                userId:
                  authenticatedUserId,
              }
            );
        } catch (error) {
          console.error(
            "mark_read error:",
            error
          );
        }
      }
    );

    /*
     * IMPORTANT:
     * Clean up only this socket when it disconnects.
     */
    socket.on(
      "disconnect",
      async () => {
        clearTimeout(expiryTimer);

        console.log(
          `🔴 Socket disconnected: ${socket.id}`
        );

        await removeSocketPresence(
          socket.userId,
          socket.id
        );
      }
    );

    /*
     * Presence setup. Runs LAST so that all handlers above are already
     * listening while these (slow) Redis/MongoDB calls are in flight.
     */
    try {
      socket.join(userRoom);

      console.log(
        `👤 Joined user presence room: ${userRoom}`
      );

      const existingSockets =
        await presenceClient.sCard(
          presenceKey
        );

      await presenceClient.sAdd(
        presenceKey,
        socket.id
      );

      await presenceClient.sAdd(
        ONLINE_USERS_KEY,
        userId
      );

      if (existingSockets === 0) {
        await User.findByIdAndUpdate(
          userId,
          {
            isOnline: true,
          }
        );

        io.emit("user_online", {
          userId,
        });

        console.log(
          `🟢 User became online: ${userId}`
        );
      } else {
        console.log(
          `🟢 User opened another socket: ${userId}`
        );
      }

      const onlineUserIds =
        await presenceClient.sMembers(
          ONLINE_USERS_KEY
        );

      socket.emit(
        "online_users",
        onlineUserIds
      );

      console.log(
        `🌐 Redis online users: ${onlineUserIds.length}`
      );

      // The socket may have disconnected while the calls above were in
      // flight. Its disconnect handler already ran, so clean up the entry
      // we just added; otherwise the user would stay "online" forever.
      if (!socket.connected) {
        await removeSocketPresence(
          userId,
          socket.id
        );
      }
    } catch (error) {
      console.error(
        "Redis presence connection error:",
        error
      );
    }
  });
};

module.exports = socketHandler;
