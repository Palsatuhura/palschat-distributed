import { create } from "zustand";

/**
 * Chat Store (Zustand)
 * Manages all real-time chat state: users, conversations, messages, and presence.
 *
 * State:
 *   - users: all registered users from /api/users
 *   - conversations: all conversations for the current user
 *   - activeConversation: the currently open conversation object
 *   - messages: messages for the activeConversation
 *   - onlineUsers: Set of user IDs currently online
 *   - typingUsers: Map of conversationId → Set of userIds who are typing
 *   - isLoadingMessages: loading state for message fetch
 *   - unreadCounts: Map of conversationId → unread message count
 */
const useChatStore = create((set, get) => ({
  users: [],
  conversations: [],
  activeConversation: null,
  messages: [],
  onlineUsers: new Set(),
  typingUsers: {}, // { conversationId: { userId: userName } }
  isLoadingMessages: false,
  unreadCounts: {}, // { conversationId: count }

  // ─── User Actions ──────────────────────────────────────────────────────
  setUsers: (users) => set({ users }),

  // ─── Conversation Actions ──────────────────────────────────────────────
  setConversations: (conversations) => set({ conversations }),

  /**
   * Adds a new conversation or updates an existing one in the list.
   * Used when a new DM or group is created.
   */
  addOrUpdateConversation: (conversation) =>
    set((state) => {
      const exists = state.conversations.find((c) => c._id === conversation._id);
      if (exists) {
        return {
          conversations: state.conversations.map((c) =>
            c._id === conversation._id ? conversation : c
          ),
        };
      }
      return { conversations: [conversation, ...state.conversations] };
    }),

  setActiveConversation: (conversation) =>
    set({
      activeConversation: conversation,
      messages: [], // clear messages when switching conversation
    }),

  // ─── Message Actions ───────────────────────────────────────────────────
  setMessages: (messages) => set({ messages }),
  setIsLoadingMessages: (val) => set({ isLoadingMessages: val }),

  /**
   * Appends a new message to the current message list.
   * Called when a "receive_message" socket event fires.
   */
  addMessage: (message) =>
    set((state) => {
      // Avoid duplicates (in case of echo)
      const exists = state.messages.find((m) => m._id === message._id);
      if (exists) return {};
      return { messages: [...state.messages, message] };
    }),

  /**
   * Updates the lastMessage of a conversation for sidebar preview.
   * Also increments unread count if the conversation is not active.
   */
  updateConversationLastMessage: (conversationId, message, activeConvId) =>
    set((state) => {
      const conversations = state.conversations.map((c) => {
        if (c._id === conversationId) {
          return { ...c, lastMessage: message, updatedAt: message.createdAt };
        }
        return c;
      });

      // Sort by most recent
      conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      // Increment unread count if not the active conversation
      let unreadCounts = { ...state.unreadCounts };
      if (conversationId !== activeConvId) {
        unreadCounts[conversationId] = (unreadCounts[conversationId] || 0) + 1;
      }

      return { conversations, unreadCounts };
    }),

  /**
   * Reset unread count for a conversation when user opens it.
   */
  clearUnreadCount: (conversationId) =>
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [conversationId]: 0 },
    })),

  // ─── Presence Actions ──────────────────────────────────────────────────
  setOnlineUsers: (userIds) => set({ onlineUsers: new Set(userIds) }),

  setUserOnline: (userId) =>
    set((state) => {
      const newSet = new Set(state.onlineUsers);
      newSet.add(userId);
      return { onlineUsers: newSet };
    }),

  setUserOffline: (userId) =>
    set((state) => {
      const newSet = new Set(state.onlineUsers);
      newSet.delete(userId);
      // Update lastSeen in the users list
      const users = state.users.map((u) =>
        u._id === userId ? { ...u, isOnline: false, lastSeen: new Date() } : u
      );
      return { onlineUsers: newSet, users };
    }),

  // ─── Typing Actions ────────────────────────────────────────────────────
  setUserTyping: (conversationId, userId, userName) =>
    set((state) => ({
      typingUsers: {
        ...state.typingUsers,
        [conversationId]: {
          ...(state.typingUsers[conversationId] || {}),
          [userId]: userName,
        },
      },
    })),

  clearUserTyping: (conversationId, userId) =>
    set((state) => {
      const conv = { ...(state.typingUsers[conversationId] || {}) };
      delete conv[userId];
      return {
        typingUsers: { ...state.typingUsers, [conversationId]: conv },
      };
    }),
}));

export default useChatStore;
