import { useEffect, useState } from "react";
import { format, isToday } from "date-fns";
import { previewText } from "../lib/attachmentInfo";
import { clearAttachmentCache } from "../lib/attachments";
import api from "../lib/axios";
import useAuthStore from "../store/authStore";
import useChatStore from "../store/chatStore";
import UserAvatar from "./UserAvatar";
import CreateGroupModal from "./CreateGroupModal";
import ProfileModal from "./ProfileModal";
import SecurityModal from "./SecurityModal";
import SettingsModal from "./SettingsModal";
import { SkeletonRows } from "./Skeleton";
import GroupAvatar from "./GroupAvatar";
import socket from "../lib/socket";

/**
 * Sidebar
 * The left panel of the chat layout.
 * - Lists all users and existing conversations
 * - Search/filter by name
 * - Shows online status dots and unread message badges
 * - Contains logout button and group creation button
 *
 * Props:
 *   - onConversationSelect: (conversation) => void — called on mobile to close sidebar
 *   - isMobileOpen: boolean — controls mobile visibility
 *   - onMobileClose: () => void — closes sidebar on mobile
 */

const formatPreviewTime = (date) => {
  if (!date) return "";
  const d = new Date(date);
  return isToday(d) ? format(d, "h:mm a") : format(d, "MMM d");
};

const Sidebar = ({ onConversationSelect, isMobileOpen, onMobileClose }) => {
  // One selector per value: the component re-renders only when THAT value
  // changes, not on every typing event or presence update in the store.
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const users = useChatStore((s) => s.users);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversation = useChatStore((s) => s.activeConversation);
  const onlineUsers = useChatStore((s) => s.onlineUsers);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const typingUsers = useChatStore((s) => s.typingUsers);
  const setUsers = useChatStore((s) => s.setUsers);
  const setConversations = useChatStore((s) => s.setConversations);
  const setBlockedIds = useChatStore((s) => s.setBlockedIds);
  const addOrUpdateConversation = useChatStore((s) => s.addOrUpdateConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const clearUnreadCount = useChatStore((s) => s.clearUnreadCount);

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("chats"); // "chats" | "people"
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingConvs, setIsLoadingConvs] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Load all users and conversations on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoadingUsers(true);
        setIsLoadingConvs(true);
        const [usersRes, convsRes] = await Promise.all([
          api.get("/users"),
          api.get("/conversations"),
        ]);
        setUsers(usersRes.data);
        setConversations(convsRes.data);
        // The blocked list is separate so a problem there never hides chats.
        api
          .get("/users/blocked")
          .then(({ data }) => setBlockedIds(data.blocked))
          .catch(() => {});
      } catch (err) {
        console.error("Sidebar fetch error:", err);
      } finally {
        setIsLoadingUsers(false);
        setIsLoadingConvs(false);
      }
    };
    fetchData();
  }, []);

  // Open or create a DM conversation with a user from the People tab
  const handleUserClick = async (selectedUser) => {
    try {
      const { data } = await api.post("/conversations", {
        participantId: selectedUser._id,
      });
      addOrUpdateConversation(data);
      openConversation(data);
    } catch (err) {
      console.error("Create conversation error:", err);
    }
  };

  const openConversation = (conversation) => {
    setActiveConversation(conversation);
    clearUnreadCount(conversation._id);

    // ChatWindow handles joining the Socket.IO conversation room.
    // Keeping room management in one place prevents duplicate joins.

    // On mobile, close the sidebar after selecting
    onConversationSelect?.();
  };

  // Get the "other" participant for 1-on-1 DM display
  const getOtherParticipant = (conv) => {
    return conv.participants?.find((p) => p._id !== user?._id);
  };

  // Get display name for a conversation (group name or other user's name)
  const getConvName = (conv) => {
    if (conv.isGroup) return conv.groupName;
    return getOtherParticipant(conv)?.name || "Unknown";
  };

  // Get last message preview text
  // Is anybody other than me typing in this conversation?
  const isSomeoneTyping = (conversationId) =>
    Object.keys(typingUsers[conversationId] || {}).some((id) => id !== user?._id);

  const getLastMessagePreview = (conv) => {
    if (!conv.lastMessage) return "No messages yet";
    const msg = conv.lastMessage;
    if (msg.deletedAt) return "This message was deleted";
    const senderName = msg.sender?._id === user?._id ? "You" : msg.sender?.name?.split(" ")[0];
    const body = previewText(msg);
    return `${senderName}: ${body.substring(0, 35)}${body.length > 35 ? "..." : ""}`;
  };

  // Filter conversations by search term; archived chats live in their own
  // list, and pinned chats stay on top (the rest keep the newest-first order).
  const matching = conversations.filter((conv) =>
    getConvName(conv).toLowerCase().includes(searchTerm.toLowerCase())
  );
  const archivedCount = conversations.filter((c) => c.archived).length;
  const shown = matching.filter((c) => Boolean(c.archived) === showArchived);
  const filteredConversations = showArchived
    ? shown
    : [...shown.filter((c) => c.pinned), ...shown.filter((c) => !c.pinned)];

  // Filter users by search term
  const filteredUsers = users.filter((u) =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleLogout = async () => {

    // Prevent Socket.IO from reconnecting after logout.
    socket.io.opts.reconnection = false;

    // Remove the authentication token from the socket.
    socket.auth = {};

    // Disconnect the current socket.
    if (socket.connected || socket.active) {
      socket.disconnect();
    }

    // End this login on the server too, so its token stops working
    // everywhere. If the server cannot be reached we still sign out here.
    // Two tries, because the free server can be slow to answer the first one.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await api.post("/auth/logout", null, { timeout: 5000, skipAuthRedirect: true });
        break;
      } catch (err) {
        // A real answer from the server (even an error) will not change on a retry.
        if (err.response) break;
      }
    }

    // Forget the previous user's conversations and messages, so the next
    // login in this browser starts clean.
    useChatStore.getState().resetChat();
    clearAttachmentCache();

    // Clear the authenticated user.
    logout();

  };

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-40 z-20 md:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Sidebar panel */}
      <aside className={`
        fixed md:relative z-30 md:z-auto
        w-full md:w-80 h-full flex flex-col bg-surface border-r border-line
        transition-transform duration-300 ease-in-out
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-line">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowProfile(true)}
              title="Edit your profile"
              className="flex items-center gap-3 text-left rounded-lg hover:bg-surface-2 -m-1 p-1"
            >
              <UserAvatar user={user} isOnline={true} size="md" />
              <div>
                <p className="font-semibold text-ink text-sm leading-tight">{user?.name}</p>
                <p className="text-xs text-success-text font-medium">Online</p>
              </div>
            </button>
          </div>
          <div className="flex items-center gap-1">
            {/* New group button */}
            <button
              onClick={() => setShowGroupModal(true)}
              title="Create group"
              className="p-2 hover:bg-surface-3 rounded-full text-ink-3 hover:text-ink-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {/* Settings button */}
            <button
              onClick={() => setShowSettings(true)}
              title="Settings"
              aria-label="Settings"
              className="p-2 hover:bg-surface-3 rounded-full text-ink-3 hover:text-ink-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {/* Logout button */}
            <button
              onClick={handleLogout}
              title="Logout"
              className="p-2 hover:bg-danger-soft rounded-full text-ink-3 hover:text-danger-text"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search..."
              className="w-full pl-9 pr-3 py-2 bg-surface-3 border-0 rounded-xl text-sm text-ink placeholder-ink-4 focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex mx-4 mb-2 p-1 gap-1 bg-surface-3 rounded-xl">
          {["chats", "people"].map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-lg capitalize
                ${activeTab === tab
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-3 hover:text-ink-2"
                }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2">
          {/* ── Chats Tab ── */}
          {activeTab === "chats" && (
            <>
              {isLoadingConvs ? (
                <SkeletonRows />
              ) : filteredConversations.length === 0 && !showArchived && archivedCount === 0 ? (
                <div className="text-center py-10 px-4">
                  <p className="text-ink-4 text-sm">No conversations yet.</p>
                  <p className="text-ink-4 text-xs mt-1">Go to People to start chatting!</p>
                </div>
              ) : (
                <>
                {showArchived ? (
                  <button
                    type="button"
                    onClick={() => setShowArchived(false)}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-brand-text hover:bg-surface-2 rounded-lg"
                  >
                    ← Back to chats
                  </button>
                ) : (
                  archivedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowArchived(true)}
                      className="w-full text-left px-3 py-2 text-xs font-medium text-ink-2 hover:bg-surface-2 rounded-lg"
                    >
                      Archived ({archivedCount})
                    </button>
                  )
                )}
                {filteredConversations.length === 0 && (
                  <p className="text-center text-ink-4 text-sm py-8">
                    {showArchived ? "No archived chats." : "No chats here. Open Archived above."}
                  </p>
                )}
                {filteredConversations.map((conv) => {
                  const other = getOtherParticipant(conv);
                  const isActive = activeConversation?._id === conv._id;
                  const unread = unreadCounts[conv._id] || 0;
                  const isOnline = !conv.isGroup && onlineUsers.has(other?._id);

                  return (
                    <button
                      key={conv._id}
                      onClick={() => openConversation(conv)}
                      className={`w-full my-0.5 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left
                        ${isActive ? "bg-brand-soft" : "hover:bg-surface-2"}`}
                    >
                      {/* Avatar */}
                      {conv.isGroup ? (
                        <GroupAvatar avatar={conv.groupAvatar} size="md" />
                      ) : (
                        <UserAvatar user={other} isOnline={isOnline} size="md" />
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-sm font-semibold truncate ${isActive ? "text-brand-text" : "text-ink"}`}>
                            {getConvName(conv)}
                          </p>
                          <span className="text-xs text-ink-4 flex-shrink-0 ml-1 flex items-center gap-1">
                            {conv.muted && <span title="Muted" aria-label="Muted">🔇</span>}
                            {conv.pinned && <span title="Pinned" aria-label="Pinned">📌</span>}
                            {formatPreviewTime(conv.updatedAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          {isSomeoneTyping(conv._id) ? (
                            <p className="text-xs text-success-text italic truncate">typing...</p>
                          ) : (
                            <p className="text-xs text-ink-3 truncate">{getLastMessagePreview(conv)}</p>
                          )}
                          {unread > 0 && (
                            <span
                              className={`ml-1 flex-shrink-0 w-5 h-5 text-white text-xs rounded-full flex items-center justify-center font-medium ${
                                conv.muted ? "bg-ink-4" : "bg-brand"
                              }`}
                            >
                              {unread > 9 ? "9+" : unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                </>
              )}
            </>
          )}

          {/* ── People Tab ── */}
          {activeTab === "people" && (
            <>
              {isLoadingUsers ? (
                <SkeletonRows />
              ) : filteredUsers.length === 0 ? (
                <p className="text-center text-ink-4 text-sm py-8">No users found</p>
              ) : (
                filteredUsers.map((u) => (
                  <button
                    key={u._id}
                    onClick={() => handleUserClick(u)}
                    className="w-full my-0.5 flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-2 text-left"
                  >
                    <UserAvatar user={u} isOnline={onlineUsers.has(u._id)} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink">{u.name}</p>
                      <p className={`text-xs font-medium ${onlineUsers.has(u._id) ? "text-success-text" : "text-ink-4"}`}>
                        {onlineUsers.has(u._id) ? "Online" : "Offline"}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </aside>

      {/* Group creation modal */}
      {showGroupModal && <CreateGroupModal onClose={() => setShowGroupModal(false)} />}
      {showProfile && (
        <ProfileModal
          onClose={() => setShowProfile(false)}
          onOpenSecurity={() => {
            setShowProfile(false);
            setShowSecurity(true);
          }}
        />
      )}
      {showSecurity && <SecurityModal onClose={() => setShowSecurity(false)} />}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onOpenProfile={() => {
            setShowSettings(false);
            setShowProfile(true);
          }}
          onOpenSecurity={() => {
            setShowSettings(false);
            setShowSecurity(true);
          }}
          onLogout={() => {
            setShowSettings(false);
            handleLogout();
          }}
        />
      )}
    </>
  );
};

export default Sidebar;
