const jwt = require("jsonwebtoken");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const User = require("../models/User");

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

      if (!token) {
        return next(
          new Error("Authentication required")
        );
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET
      );

      const user =
        await User.findById(decoded.id)
          .select("-password");

      if (!user) {
        return next(
          new Error("User no longer exists")
        );
      }

      socket.userId =
        user._id.toString();

      socket.user = user;

      next();
    } catch (error) {
      console.error(
        "Socket authentication failed:",
        error.message
      );

      next(
        new Error(
          "Invalid or expired authentication token"
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
    } catch (error) {
      console.error(
        "Redis presence connection error:",
        error
      );
    }

    socket.on(
      "join_conversation",
      (conversationId) => {
        socket.join(conversationId);

        console.log(
          `📨 Socket ${socket.id} joined room: ${conversationId}`
        );
      }
    );

    socket.on(
      "leave_conversation",
      (conversationId) => {
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
          const {
            conversationId,
            text,
          } = data;

          const senderId =
            socket.userId;

          if (
            !conversationId ||
            !senderId ||
            !text?.trim()
          ) {
            socket.emit("error", {
              message:
                "Invalid message data",
            });

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

          socket.emit("error", {
            message:
              "Failed to send message",
          });
        }
      }
    );

    socket.on(
      "typing",
      (data) => {
        socket
          .to(data.conversationId)
          .emit("typing", {
            userId:
              socket.userId,
            userName:
              socket.user.name,
            conversationId:
              data.conversationId,
          });
      }
    );

    socket.on(
      "stop_typing",
      (data) => {
        socket
          .to(data.conversationId)
          .emit("stop_typing", {
            userId:
              socket.userId,
            conversationId:
              data.conversationId,
          });
      }
    );

    socket.on(
      "mark_read",
      async (data) => {
        try {
          const {
            conversationId,
          } = data;

          const authenticatedUserId =
            socket.userId;

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
        console.log(
          `🔴 Socket disconnected: ${socket.id}`
        );

        await removeSocketPresence(
          socket.userId,
          socket.id
        );
      }
    );
  });
};

module.exports = socketHandler;
