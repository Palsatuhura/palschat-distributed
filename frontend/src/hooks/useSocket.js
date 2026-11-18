import { useEffect } from "react";
import socket from "../lib/socket";
import useAuthStore from "../store/authStore";
import useChatStore from "../store/chatStore";
import { endSession } from "../lib/session";
import api from "../lib/axios";

// Latest messages to re-fetch after a reconnect (to fill the offline gap).
const RESYNC_PAGE_SIZE = 50;

// A typing indicator that never receives its "stop" (the other person closed
// the tab, lost signal...) must not stay on screen forever.
const TYPING_EXPIRY_MS = 6000;
const typingExpiryTimers = new Map();

// While one conversation-list refresh is running, further requests reuse it.
let refreshingConversations = null;

const refreshConversations = () => {
  if (!refreshingConversations) {
    refreshingConversations = api
      .get("/conversations")
      .then(({ data }) => {
        useChatStore.getState().setConversations(data);
      })
      .finally(() => {
        refreshingConversations = null;
      });
  }

  return refreshingConversations;
};

const useSocket = () => {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);

  const setOnlineUsers = useChatStore((state) => state.setOnlineUsers);
  const setUserOnline = useChatStore((state) => state.setUserOnline);
  const setUserOffline = useChatStore((state) => state.setUserOffline);
  const addMessage = useChatStore((state) => state.addMessage);
  const updateConversationLastMessage = useChatStore(
    (state) => state.updateConversationLastMessage
  );
  const setUserTyping = useChatStore((state) => state.setUserTyping);
  const clearUserTyping = useChatStore((state) => state.clearUserTyping);

  useEffect(() => {
    if (!user || !token) {
      return;
    }

    socket.auth = {
      token,
    };

    // Logging out turns reconnection off (so the old token is not retried).
    // Turn it back on for the next login in the same page session.
    socket.io.opts.reconnection = true;

    let hasConnectedBefore = false;

    const joinActiveConversation = () => {
      const { activeConversation } = useChatStore.getState();

      if (!activeConversation?._id) {
        return;
      }

      console.log(
        `📨 Rejoining conversation room: ${activeConversation._id}`
      );

      socket.emit(
        "join_conversation",
        activeConversation._id
      );
    };

    // After a reconnect, messages sent while we were offline were never
    // delivered to this browser: fetch the latest ones and merge them in.
    const resync = async () => {
      try {
        await refreshConversations();

        const { activeConversation, mergeMessages } =
          useChatStore.getState();

        if (!activeConversation?._id) return;

        const { data } = await api.get(
          `/conversations/${activeConversation._id}/messages`,
          { params: { limit: RESYNC_PAGE_SIZE } }
        );

        // The user may have switched conversation while this was loading.
        if (
          useChatStore.getState().activeConversation?._id ===
          activeConversation._id
        ) {
          mergeMessages(data);
        }
      } catch (error) {
        console.error("Resync after reconnect failed:", error);
      }
    };

    const handleConnect = () => {
      console.log(
        `🔐 Secure Socket.IO connection established: ${socket.id}`
      );

      joinActiveConversation();

      if (hasConnectedBefore) {
        resync();
      }

      hasConnectedBefore = true;
    };

    const handleConnectError = (error) => {
      console.error(
        "❌ Socket authentication/connection error:",
        error.message
      );

      // The server says WHY the handshake failed. An expired or invalid
      // token will never start working, so retrying forever would be
      // pointless: end the session instead.
      const code = error?.data?.code;

      if (code === "TOKEN_EXPIRED") {
        endSession("expired");
      } else if (code === "TOKEN_INVALID") {
        endSession("invalid");
      }
    };

    // Sent by the server just before it closes a socket whose token expired.
    const handleSessionExpired = () => {
      endSession("expired");
    };

    const handleDisconnect = (reason) => {
      console.warn(
        "⚠️ Socket disconnected:",
        reason
      );
    };

    const handleOnlineUsers = (userIds) => {
      console.log(
        "🌐 Distributed online users:",
        userIds
      );

      setOnlineUsers(userIds);
    };

    const handleUserRegistered = (newUser) => {
      const myId = useAuthStore.getState().user?._id;
      if (newUser && newUser._id && newUser._id !== myId) {
        useChatStore.getState().addUser(newUser);
      }
    };

    const handleUserUpdated = (profile) => {
      if (!profile || !profile._id) return;
      const patch = { avatar: profile.avatar, about: profile.about };
      useChatStore.getState().updateUserProfile(profile._id, patch);
      if (profile._id === useAuthStore.getState().user?._id) {
        useAuthStore.getState().updateUser(patch);
      }
    };

    const handleUserOnline = ({ userId }) => {
      console.log(
        `🟢 User online: ${userId}`
      );

      setUserOnline(userId);
    };

    const handleUserOffline = ({ userId }) => {
      console.log(
        `🔴 User offline: ${userId}`
      );

      setUserOffline(userId);
    };

    const handleReceiveMessage = (message) => {
      const {
        activeConversation,
        conversations,
      } = useChatStore.getState();

      const currentUserId =
        useAuthStore.getState().user?._id;

      const senderId =
        message.sender?._id ?? message.sender;

      const isFromOther = senderId !== currentUserId;

      // They sent it, so they are no longer "typing".
      if (isFromOther) {
        clearUserTyping(message.conversation, senderId);
      }

      if (
        message.conversation ===
        activeConversation?._id
      ) {
        addMessage(message);
      }

      if (isFromOther) {
        // This device has the message: the sender's ticks can go double.
        socket.emit("mark_delivered", {
          conversationId: message.conversation,
        });

        // ...and if the person is looking at that chat right now, it is read.
        // (Temporary diagnostics: the lines starting with 🧾 will be removed.)
        console.log(
          `🧾 message from other: chatOpen=${message.conversation === activeConversation?._id}, tab=${document.visibilityState}`
        );

        if (
          message.conversation === activeConversation?._id &&
          document.visibilityState === "visible"
        ) {
          socket.emit("mark_read", {
            conversationId: message.conversation,
          });
        }
      }

      const isKnown = conversations.some(
        (c) => c._id === message.conversation
      );

      if (!isKnown) {
        // First message of a conversation somebody else started (or a group
        // we were just added to): load the list, then record the message.
        refreshConversations()
          .then(() =>
            updateConversationLastMessage(
              message.conversation,
              message,
              useChatStore.getState().activeConversation?._id,
              currentUserId
            )
          )
          .catch((error) =>
            console.error("Could not load new conversation:", error)
          );

        return;
      }

      updateConversationLastMessage(
        message.conversation,
        message,
        activeConversation?._id,
        currentUserId
      );
    };

    const handleTyping = ({
      userId,
      userName,
      conversationId,
    }) => {
      setUserTyping(
        conversationId,
        userId,
        userName
      );

      const timerKey = `${conversationId}:${userId}`;

      clearTimeout(typingExpiryTimers.get(timerKey));

      typingExpiryTimers.set(
        timerKey,
        setTimeout(() => {
          typingExpiryTimers.delete(timerKey);
          clearUserTyping(conversationId, userId);
        }, TYPING_EXPIRY_MS)
      );
    };

    // Another participant's app received / read our messages: update ticks.
    const handleMessagesRead = ({ conversationId, userId }) => {
      console.log(`🧾 messages_read from ${userId}`);
      useChatStore
        .getState()
        .applyReceipt(conversationId, userId, "readBy");
    };

    const handleMessagesDelivered = ({ conversationId, userId }) => {
      console.log(`🧾 messages_delivered to ${userId}`);
      useChatStore
        .getState()
        .applyReceipt(conversationId, userId, "deliveredTo");
    };

    const handleStopTyping = ({
      userId,
      conversationId,
    }) => {
      clearTimeout(typingExpiryTimers.get(`${conversationId}:${userId}`));
      typingExpiryTimers.delete(`${conversationId}:${userId}`);

      clearUserTyping(
        conversationId,
        userId
      );
    };

    socket.on(
      "connect",
      handleConnect
    );

    socket.on(
      "connect_error",
      handleConnectError
    );

    socket.on(
      "session_expired",
      handleSessionExpired
    );

    socket.on(
      "disconnect",
      handleDisconnect
    );

    socket.on(
      "online_users",
      handleOnlineUsers
    );

    socket.on(
      "user_registered",
      handleUserRegistered
    );

    socket.on(
      "user_updated",
      handleUserUpdated
    );

    socket.on(
      "user_online",
      handleUserOnline
    );

    socket.on(
      "user_offline",
      handleUserOffline
    );

    socket.on(
      "receive_message",
      handleReceiveMessage
    );

    socket.on(
      "typing",
      handleTyping
    );

    socket.on(
      "stop_typing",
      handleStopTyping
    );

    socket.on("messages_read", handleMessagesRead);
    socket.on("messages_delivered", handleMessagesDelivered);

    if (!socket.connected) {
      console.log(
        "🔌 Connecting authenticated socket..."
      );

      socket.connect();
    } else {
      joinActiveConversation();
    }

    return () => {
      socket.off(
        "connect",
        handleConnect
      );

      socket.off(
        "connect_error",
        handleConnectError
      );

      socket.off(
        "session_expired",
        handleSessionExpired
      );

      socket.off(
        "disconnect",
        handleDisconnect
      );

      socket.off(
        "online_users",
        handleOnlineUsers
      );

      socket.off(
        "user_registered",
        handleUserRegistered
      );

      socket.off(
        "user_updated",
        handleUserUpdated
      );

      socket.off(
        "user_online",
        handleUserOnline
      );

      socket.off(
        "user_offline",
        handleUserOffline
      );

      socket.off(
        "receive_message",
        handleReceiveMessage
      );

      socket.off(
        "typing",
        handleTyping
      );

      socket.off(
        "stop_typing",
        handleStopTyping
      );

      socket.off("messages_read", handleMessagesRead);
      socket.off("messages_delivered", handleMessagesDelivered);

      /*
       * Do not disconnect here.
       *
       * Socket.IO should remain alive during temporary component
       * lifecycle changes and reconnect automatically when necessary.
       *
       * Logout explicitly disconnects the socket in Sidebar.
       */
    };
  }, [
    user,
    token,
    setOnlineUsers,
    setUserOnline,
    setUserOffline,
    addMessage,
    updateConversationLastMessage,
    setUserTyping,
    clearUserTyping,
  ]);
};

export default useSocket;
