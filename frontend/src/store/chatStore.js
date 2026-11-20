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
// Fresh copy of the data part of the store. Used at start-up and by
// resetChat() on logout, so the next person to log in on this browser never
// sees the previous user's conversations or messages.
const initialData = () => ({
  users: [],
  conversations: [],
  activeConversation: null,
  messages: [],
  hasMoreMessages: false, // true while older messages exist on the server
  onlineUsers: new Set(),
  typingUsers: {}, // { conversationId: { userId: userName } }
  isLoadingMessages: false,
  unreadCounts: {}, // { conversationId: count }
  blockedIds: [], // people I blocked
});

// My own pin / mute / archive flags travel with the conversation. Live
// updates from the server (a renamed group, say) do not carry them, so keep
// what is already known.
const PREF_KEYS = ["pinned", "muted", "archived"];
const keepPrefs = (old) => {
  const kept = {};
  for (const key of PREF_KEYS) if (old && old[key] !== undefined) kept[key] = old[key];
  return kept;
};

// Chat order: oldest first, ties broken by id (matches the server's order).
const byAge = (a, b) =>
  new Date(a.createdAt) - new Date(b.createdAt) || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);

const useChatStore = create((set, get) => ({
  ...initialData(),

  /** Forget everything (logout). */
  resetChat: () => set(initialData()),

  // ─── User Actions ──────────────────────────────────────────────────────
  setUsers: (users) => set({ users }),

  /**
   * A person changed their picture or about line. Update every place that
   * holds a copy of their profile: the People list and the members of every
   * conversation (including the open one).
   */
  updateUserProfile: (userId, patch) =>
    set((state) => {
      const apply = (u) => (u && u._id === userId ? { ...u, ...patch } : u);
      const mapConv = (c) =>
        c && c.participants ? { ...c, participants: c.participants.map(apply) } : c;
      return {
        users: state.users.map(apply),
        conversations: state.conversations.map(mapConv),
        activeConversation: mapConv(state.activeConversation),
      };
    }),

  /** Adds one user to the People list (ignored if already present). */
  addUser: (newUser) =>
    set((state) =>
      state.users.some((u) => u._id === newUser._id)
        ? state
        : { users: [...state.users, newUser] }
    ),

  // ─── Conversation Actions ──────────────────────────────────────────────
  setConversations: (conversations) => set({ conversations }),

  /**
   * Adds a new conversation or updates an existing one in the list.
   * Used when a new DM or group is created.
   */
  addOrUpdateConversation: (conversation) =>
    set((state) => {
      const exists = state.conversations.find((c) => c._id === conversation._id);
      // Keep the open chat in step, so a renamed group or a changed member
      // list shows at once in its header and info panel.
      const activeConversation =
        state.activeConversation?._id === conversation._id
          ? { ...state.activeConversation, ...conversation }
          : state.activeConversation;
      if (exists) {
        return {
          conversations: state.conversations.map((c) =>
            c._id === conversation._id ? { ...keepPrefs(c), ...conversation } : c
          ),
          activeConversation,
        };
      }
      return { conversations: [conversation, ...state.conversations], activeConversation };
    }),

  /**
   * A conversation is gone for this user (they left a group or an admin
   * removed them). Drop it, its unread count, and close it if it is open.
   */
  removeConversation: (conversationId) =>
    set((state) => {
      const closing = state.activeConversation?._id === conversationId;
      const unreadCounts = { ...state.unreadCounts };
      delete unreadCounts[conversationId];
      return {
        conversations: state.conversations.filter((c) => c._id !== conversationId),
        unreadCounts,
        ...(closing ? { activeConversation: null, messages: [], hasMoreMessages: false } : {}),
      };
    }),

  /**
   * "Clear chat" (only for me): empty the open message list and drop the
   * preview in the conversation list.
   */
  clearConversationMessages: (conversationId) =>
    set((state) => {
      const unreadCounts = { ...state.unreadCounts };
      delete unreadCounts[conversationId];
      const open = state.activeConversation?._id === conversationId;
      return {
        conversations: state.conversations.map((c) =>
          c._id === conversationId ? { ...c, lastMessage: null } : c
        ),
        unreadCounts,
        ...(open ? { messages: [], hasMoreMessages: false } : {}),
      };
    }),

  /**
   * "Delete for everyone": the text is gone for all; a note stays in place.
   * Also updates quotes of it inside replies, and the list preview.
   */
  markMessageDeleted: (conversationId, messageId, deletedAt) =>
    set((state) => {
      const wipe = (m) => {
        if (!m) return m;
        if (m._id === messageId) return { ...m, text: "", attachment: null, deletedAt };
        if (m.replyTo && m.replyTo._id === messageId) {
          return { ...m, replyTo: { ...m.replyTo, text: "", attachment: null, deletedAt } };
        }
        return m;
      };
      return {
        messages: state.messages.map(wipe),
        conversations: state.conversations.map((c) =>
          c._id === conversationId && c.lastMessage ? { ...c, lastMessage: wipe(c.lastMessage) } : c
        ),
      };
    }),

  /** "Delete for me": drop one message from my screen. */
  removeMessage: (messageId) =>
    set((state) => ({ messages: state.messages.filter((m) => m._id !== messageId) })),

  /** My pin / mute / archive settings changed (here or on another device). */
  applyConversationPrefs: (conversationId, prefs) =>
    set((state) => {
      const patch = {};
      for (const key of PREF_KEYS) if (typeof prefs[key] === "boolean") patch[key] = prefs[key];
      const apply = (c) => (c && c._id === conversationId ? { ...c, ...patch } : c);
      return {
        conversations: state.conversations.map(apply),
        activeConversation: apply(state.activeConversation),
      };
    }),

  setBlockedIds: (blockedIds) => set({ blockedIds: Array.isArray(blockedIds) ? blockedIds : [] }),

  /** A person deleted their account: take them off the People list. */
  removeUser: (userId) =>
    set((state) => ({ users: state.users.filter((u) => u._id !== userId) })),

  setActiveConversation: (conversation) =>
    set((state) => {
      // Clicking the conversation that is already open must not wipe its
      // messages: nothing would reload them.
      if (conversation?._id && conversation._id === state.activeConversation?._id) {
        return { activeConversation: conversation };
      }

      return {
        activeConversation: conversation,
        messages: [], // clear messages when switching conversation
        hasMoreMessages: false,
      };
    }),

  // ─── Message Actions ───────────────────────────────────────────────────
  setMessages: (messages) => set({ messages }),
  setHasMoreMessages: (hasMoreMessages) => set({ hasMoreMessages }),

  /** Adds an OLDER page in front of the messages already shown. */
  prependMessages: (older) =>
    set((state) => {
      const known = new Set(state.messages.map((m) => m._id));
      const fresh = older.filter((m) => !known.has(m._id));
      return { messages: [...fresh, ...state.messages] };
    }),

  /**
   * Merges a list of messages into the current ones (after a reconnect, to
   * fill the gap while offline). Duplicates are dropped and order is kept.
   */
  mergeMessages: (incoming) =>
    set((state) => {
      const byId = new Map(state.messages.map((m) => [m._id, m]));
      let changed = false;
      for (const m of incoming) {
        if (!byId.has(m._id)) {
          byId.set(m._id, m);
          changed = true;
        }
      }
      if (!changed) return {};
      return { messages: [...byId.values()].sort(byAge) };
    }),
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
   * Also increments unread count if the conversation is not active and the
   * message was written by someone else (your own messages, for example sent
   * from another device, are never "unread").
   */
  updateConversationLastMessage: (conversationId, message, activeConvId, currentUserId) =>
    set((state) => {
      const conversations = state.conversations.map((c) => {
        if (c._id === conversationId) {
          return { ...c, lastMessage: message, updatedAt: message.createdAt, archived: false };
        }
        return c;
      });

      // Sort by most recent
      conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      // Increment unread count if not the active conversation
      let unreadCounts = { ...state.unreadCounts };
      const senderId = message.sender?._id ?? message.sender;
      if (conversationId !== activeConvId && senderId !== currentUserId) {
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

  /**
   * Record that `userId` received ("deliveredTo") or read ("readBy") the
   * messages of the open conversation, so their ticks update live.
   * Reading implies delivery. Messages written by `userId` are left alone.
   */
  applyReceipt: (conversationId, userId, field) =>
    set((state) => {
      if (state.activeConversation?._id !== conversationId) return {};

      const fields = field === "readBy" ? ["readBy", "deliveredTo"] : ["deliveredTo"];
      let changed = false;

      const messages = state.messages.map((message) => {
        if ((message.sender?._id ?? message.sender) === userId) return message;

        let updated = message;
        for (const name of fields) {
          const list = updated[name] || [];
          if (!list.includes(userId)) {
            updated = { ...updated, [name]: [...list, userId] };
            changed = true;
          }
        }
        return updated;
      });

      return changed ? { messages } : {};
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
