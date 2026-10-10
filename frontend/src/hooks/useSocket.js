import { useEffect } from "react";
import socket from "../lib/socket";
import useAuthStore from "../store/authStore";
import useChatStore from "../store/chatStore";

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

    const handleConnect = () => {
      console.log(
        `🔐 Secure Socket.IO connection established: ${socket.id}`
      );

      joinActiveConversation();
    };

    const handleConnectError = (error) => {
      console.error(
        "❌ Socket authentication/connection error:",
        error.message
      );
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
      } = useChatStore.getState();

      if (
        message.conversation ===
        activeConversation?._id
      ) {
        addMessage(message);
      }

      updateConversationLastMessage(
        message.conversation,
        message,
        activeConversation?._id
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
    };

    const handleStopTyping = ({
      userId,
      conversationId,
    }) => {
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
      "disconnect",
      handleDisconnect
    );

    socket.on(
      "online_users",
      handleOnlineUsers
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
        "disconnect",
        handleDisconnect
      );

      socket.off(
        "online_users",
        handleOnlineUsers
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
