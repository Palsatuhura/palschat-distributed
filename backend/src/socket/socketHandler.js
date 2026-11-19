const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const { authenticate, AuthFailure } = require("../utils/authenticate");
const { sessionRoom } = require("../utils/sessionService");
const { createEventLimiter } = require("../utils/eventLimiter");
const { isValidObjectId } = require("../utils/validators");
const { createPresence, readPresenceConfig } = require("./presence");
const {
  MAX_MESSAGE_LENGTH,
  SOCKET_EVENT_WINDOW_MS,
  SOCKET_EVENTS_PER_WINDOW,
  SOCKET_MESSAGES_PER_WINDOW,
} = require("../utils/constants");

/*
 * Presence ("who is online") lives in Redis so every backend instance sees
 * the same picture. See ./presence.js for how it stays correct when a server
 * crashes. This file decides WHEN to announce changes to clients.
 */

const socketHandler = (io, presenceClient) => {
  const getUserRoom = (userId) => `user:${userId}`;

  const config = readPresenceConfig();

  const presence = createPresence({
    redis: presenceClient,
    ttlMs: config.ttlMs,
    commandTimeoutMs: config.commandTimeoutMs,
  });

  // userId -> timer waiting to announce "offline" (see scheduleOffline).
  const offlineTimers = new Map();

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

  // Mark every message addressed to this user as delivered (they just came
  // online) and tell the senders. One query to find the affected
  // conversations, one to update, so it is cheap even for many chats.
  const deliverPendingMessages = async (userId) => {
    const conversations = await Conversation.find({ participants: userId })
      .select("participants")
      .lean();

    if (conversations.length === 0) return;

    const pending = {
      conversation: { $in: conversations.map((c) => c._id) },
      sender: { $ne: userId },
      deliveredTo: { $ne: userId },
    };

    const affected = (await Message.distinct("conversation", pending)).map(String);

    if (affected.length === 0) return;

    await Message.updateMany(pending, { $addToSet: { deliveredTo: userId } });

    for (const conversation of conversations) {
      const conversationId = String(conversation._id);

      if (!affected.includes(conversationId)) continue;

      emitToUsers(
        conversation.participants.map(String).filter((id) => id !== userId),
        "messages_delivered",
        { conversationId, userId }
      );
    }
  };

  // Like canAccessConversation, but returns the participant ids (strings) so
  // a message can be delivered to each of them, or null if the user may not
  // access the conversation.
  const getConversationInfo = async (conversationId, userId) => {
    if (!isValidObjectId(conversationId)) return null;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    })
      .select("participants readOnly")
      .lean();

    return conversation
      ? {
          ids: conversation.participants.map(String),
          readOnly: Boolean(conversation.readOnly),
        }
      : null;
  };

  const getParticipantIds = async (conversationId, userId) => {
    const info = await getConversationInfo(conversationId, userId);
    return info ? info.ids : null;
  };

  /*
   * Send an event to the private room of each given user. Unlike the
   * conversation room, a user room needs no "join" step: every authenticated
   * socket is in its own user's room from the moment it connects. Typing
   * indicators and receipts therefore reach the other person even if their
   * browser has not (or not yet) joined the conversation room.
   */
  const emitToUsers = (userIds, event, payload) => {
    if (userIds.length === 0) return;

    let target = io.to(getUserRoom(userIds[0]));

    for (const id of userIds.slice(1)) {
      target = target.to(getUserRoom(id));
    }

    target.emit(event, payload);
  };

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

  // Tell everyone this user is offline, and remember when they were last seen.
  const announceOffline = async (userId) => {
    const lastSeen = new Date();

    try {
      await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen });
    } catch (error) {
      console.error("Could not save lastSeen:", error.message);
    }

    io.emit("user_offline", { userId, lastSeen });

    console.log(`🔴 User became offline: ${userId}`);
  };

  const announceOnline = async (userId) => {
    try {
      await User.findByIdAndUpdate(userId, { isOnline: true });
    } catch (error) {
      console.error("Could not save online flag:", error.message);
    }

    io.emit("user_online", { userId });

    console.log(`🟢 User became online: ${userId}`);
  };

  /*
   * A user whose last socket closed is not announced offline immediately:
   * a page refresh or a short network blip reconnects within seconds, and
   * announcing "offline" then "online" again makes the dot flicker for
   * everyone. Wait a short grace period, then check again.
   */
  const scheduleOffline = (userId) => {
    clearTimeout(offlineTimers.get(userId));

    const timer = setTimeout(async () => {
      offlineTimers.delete(userId);

      try {
        if (await presence.claimOffline(userId)) {
          await announceOffline(userId);
        }
      } catch (error) {
        // Redis unreachable: the sweep (every server runs one) will catch it.
        console.error("Presence offline check failed:", error.message);
      }
    }, config.graceMs);

    offlineTimers.set(userId, timer);
  };

  // A socket is gone (closed, or never finished connecting).
  const handleSocketGone = async (userId, socketId) => {
    if (!userId || !socketId) return;

    try {
      await presence.removeSocket(userId, socketId);
    } catch (error) {
      console.error("Presence cleanup error:", error.message);
    }

    scheduleOffline(userId);
  };

  // Sockets connected to THIS server (other servers renew their own).
  const localEntries = () => {
    const entries = [];

    for (const socket of io.sockets.sockets.values()) {
      if (socket.userId && socket.connected) {
        entries.push({ userId: socket.userId, socketId: socket.id });
      }
    }

    return entries;
  };

  // Keep this server's sockets alive in Redis, and clean up after servers
  // that died. Timers never keep the process from exiting.
  const heartbeatTimer = setInterval(async () => {
    try {
      await presence.heartbeat(localEntries());
    } catch (error) {
      console.error("Presence heartbeat failed:", error.message);
    }
  }, config.heartbeatMs);

  const runSweep = async () => {
    try {
      for (const userId of await presence.sweep()) {
        await announceOffline(userId);
      }
    } catch (error) {
      console.error("Presence sweep failed:", error.message);
    }
  };

  const sweepTimer = setInterval(runSweep, config.sweepMs);

  heartbeatTimer.unref();
  sweepTimer.unref();

  // Clear anything left behind by a previous run right away.
  runSweep();

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

      // Signature, expiry AND "does this login session still exist" are all
      // checked in one place (utils/authenticate.js).
      const { user, session, decoded } = await authenticate(token);

      socket.userId =
        user._id.toString();

      socket.user = user;

      socket.sessionId =
        session._id.toString();

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
        error instanceof AuthFailure
          ? authError(error.message, error.code)
          : authError(
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

    /*
     * End the session when the login token expires. Without this, a socket
     * connected with a valid token would keep working for as long as the
     * connection stays open, long after the token itself had expired.
     */
    let expiryTimer = null;

    const armExpiryTimer = () => {
      clearTimeout(expiryTimer);
      expiryTimer = null;

      if (!socket.tokenExpiresAt) return;

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
    };

    armExpiryTimer();

    // Everything of one login session sits in one room, so ending the
    // session (sign out, remove device, password change) can close exactly
    // these sockets, on whichever server they are connected to.
    socket.join(sessionRoom(socket.sessionId));

    /*
     * The browser renews its login token quietly while it is in use. The
     * socket must learn the new expiry, or it would be closed at the OLD one.
     * The new token must belong to the same user AND the same session.
     */
    socket.on("renew_token", async (data, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};

      try {
        const token = data && data.token;
        if (typeof token !== "string") return reply({ ok: false });

        const renewed = await authenticate(token);

        if (
          String(renewed.user._id) !== socket.userId ||
          String(renewed.session._id) !== socket.sessionId
        ) {
          return reply({ ok: false });
        }

        socket.tokenExpiresAt =
          typeof renewed.decoded.exp === "number"
            ? renewed.decoded.exp * 1000
            : null;
        armExpiryTimer();

        return reply({ ok: true });
      } catch {
        return reply({ ok: false });
      }
    });

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
      async (data, ack) => {
        // `ack` is optional and comes from the client, so only call it if it
        // really is a function. It tells the sender what happened to the
        // message: { ok: true, message } or { ok: false, message: "why" }.
        const respond = (payload) => {
          if (typeof ack === "function") ack(payload);
        };

        const fail = (message) => {
          rejectEvent(socket, message);
          respond({ ok: false, message });
        };

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
            fail("Invalid message data");

            return;
          }

          if (
            text.trim().length >
            MAX_MESSAGE_LENGTH
          ) {
            fail(
              `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`
            );

            return;
          }

          // Authorization: only participants may post into a conversation.
          const info =
            await getConversationInfo(
              conversationId,
              senderId
            );
          const participantIds = info ? info.ids : null;

          if (info && info.readOnly) {
            // The other person deleted their account.
            fail(
              "This account was deleted. You can no longer send messages here."
            );

            return;
          }

          if (!participantIds) {
            console.warn(
              `🚫 User ${senderId} tried to post to conversation ${conversationId} without being a participant`
            );

            fail(
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
            "name"
          );

          await Conversation.findByIdAndUpdate(
            conversationId,
            {
              lastMessage:
                message._id,
              updatedAt:
                new Date(),
              // A new message brings back a chat someone had deleted.
              hiddenFor: [],
            }
          );

          // Deliver to the open conversation room AND to every participant's
          // private user room, so people who have not opened this chat (or
          // are on another screen) still get it for unread badges and the
          // sidebar preview. Socket.IO sends a socket that is in several of
          // these rooms the event only once.
          let target = io.to(conversationId);

          for (const participantId of participantIds) {
            target = target.to(getUserRoom(participantId));
          }

          target.emit(
            "receive_message",
            message
          );

          respond({ ok: true, message });

          console.log(
            `💬 Message sent in room ${conversationId} by ${senderId}`
          );
        } catch (error) {
          console.error(
            "send_message error:",
            error
          );

          fail("Failed to send message");
        }
      }
    );

    /*
     * Typing indicators are sent to the OTHER participants' private rooms.
     * Who the participants are is looked up (and remembered for a minute per
     * socket), which also proves the sender belongs to the conversation.
     */
    const participantCache = new Map();
    // Short, so people added to or removed from a group are noticed quickly.
    const PARTICIPANT_CACHE_MS = 10 * 1000;

    const otherParticipants = async (conversationId) => {
      if (!isValidObjectId(conversationId)) return null;

      const cached = participantCache.get(conversationId);

      if (cached && cached.until > Date.now()) return cached.ids;

      const all = await getParticipantIds(conversationId, socket.userId);

      if (!all) {
        participantCache.delete(conversationId);
        return null;
      }

      const ids = all.filter((id) => id !== socket.userId);

      participantCache.set(conversationId, {
        ids,
        until: Date.now() + PARTICIPANT_CACHE_MS,
      });

      return ids;
    };

    const relayTyping = (event) => async (data) => {
      try {
        // `data` is client-controlled and may be undefined.
        const conversationId = data?.conversationId;

        const others = await otherParticipants(conversationId);

        if (!others) return;

        const payload = {
          userId: socket.userId,
          conversationId,
        };

        if (event === "typing") payload.userName = socket.user.name;

        emitToUsers(others, event, payload);
      } catch (error) {
        console.error(`${event} error:`, error.message);
      }
    };

    socket.on("typing", relayTyping("typing"));
    socket.on("stop_typing", relayTyping("stop_typing"));

    /*
     * Receipts. "Delivered" means the other person's app received the
     * message; "read" means they are looking at it. Both are announced to
     * the other participants' private rooms, so the sender sees the ticks
     * change even if their browser is not in the conversation room.
     */
    socket.on(
      "mark_read",
      async (data) => {
        try {
          const conversationId =
            data?.conversationId;

          const readerId =
            socket.userId;

          // Only participants may mark messages as read.
          const participantIds =
            await getParticipantIds(
              conversationId,
              readerId
            );

          if (!participantIds) {
            return;
          }

          const result =
            await Message.updateMany(
              {
                conversation:
                  conversationId,
                readBy: {
                  $ne: readerId,
                },
                sender: {
                  $ne: readerId,
                },
              },
              {
                // Reading a message implies it was delivered.
                $addToSet: {
                  readBy: readerId,
                  deliveredTo: readerId,
                },
              }
            );

          // Nothing changed: no need to tell anybody.
          if (result.modifiedCount === 0) {
            return;
          }

          emitToUsers(
            participantIds.filter((id) => id !== readerId),
            "messages_read",
            {
              conversationId,
              userId: readerId,
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

    socket.on(
      "mark_delivered",
      async (data) => {
        try {
          const conversationId =
            data?.conversationId;

          const userIdHere =
            socket.userId;

          const participantIds =
            await getParticipantIds(
              conversationId,
              userIdHere
            );

          if (!participantIds) {
            return;
          }

          const result =
            await Message.updateMany(
              {
                conversation:
                  conversationId,
                deliveredTo: {
                  $ne: userIdHere,
                },
                sender: {
                  $ne: userIdHere,
                },
              },
              {
                $addToSet: {
                  deliveredTo: userIdHere,
                },
              }
            );

          if (result.modifiedCount === 0) {
            return;
          }

          emitToUsers(
            participantIds.filter((id) => id !== userIdHere),
            "messages_delivered",
            {
              conversationId,
              userId: userIdHere,
            }
          );
        } catch (error) {
          console.error(
            "mark_delivered error:",
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

        await handleSocketGone(
          socket.userId,
          socket.id
        );
      }
    );

    /*
     * Messages that arrived while this user was offline count as delivered
     * the moment they come back. Runs in the background and never blocks or
     * breaks the connection.
     */
    deliverPendingMessages(userId).catch((error) =>
      console.error(
        "deliverPendingMessages error:",
        error.message
      )
    );

    /*
     * Presence setup. Runs LAST so that all handlers above are already
     * listening while these (slow) Redis/MongoDB calls are in flight.
     * Presence is a convenience: if Redis is slow or down, chat itself keeps
     * working and only the online dots are affected.
     */
    try {
      socket.join(userRoom);

      console.log(
        `👤 Joined user presence room: ${userRoom}`
      );

      // The user is (still) here, so a pending "offline" must not fire.
      clearTimeout(offlineTimers.get(userId));
      offlineTimers.delete(userId);

      const becameOnline =
        await presence.addSocket(
          userId,
          socket.id
        );

      if (becameOnline) {
        await announceOnline(userId);
      } else {
        console.log(
          `🟢 User opened another socket: ${userId}`
        );
      }

      const onlineUserIds =
        await presence.onlineUserIds();

      socket.emit(
        "online_users",
        onlineUserIds
      );

      console.log(
        `🌐 Online users: ${onlineUserIds.length}`
      );

      // The socket may have disconnected while the calls above were in
      // flight. Its disconnect handler already ran, so clean up the entry
      // we just added; otherwise the user would stay "online" until it
      // expires.
      if (!socket.connected) {
        await handleSocketGone(
          userId,
          socket.id
        );
      }
    } catch (error) {
      console.error(
        "Presence setup error:",
        error.message
      );
    }
  });

  /*
   * Called on server shutdown. Stops the timers and takes this server's
   * sockets out of Redis right away, announcing offline any user who has no
   * socket left anywhere, instead of leaving them to expire.
   */
  const shutdown = async () => {
    clearInterval(heartbeatTimer);
    clearInterval(sweepTimer);

    for (const timer of offlineTimers.values()) clearTimeout(timer);
    offlineTimers.clear();

    const entries = localEntries();

    try {
      await presence.removeSockets(entries);

      const userIds = [...new Set(entries.map((e) => e.userId))];

      for (const userId of userIds) {
        if (await presence.claimOffline(userId)) {
          await announceOffline(userId);
        }
      }
    } catch (error) {
      console.error("Presence shutdown cleanup failed:", error.message);
    }
  };

  return { shutdown };
};

module.exports = socketHandler;
