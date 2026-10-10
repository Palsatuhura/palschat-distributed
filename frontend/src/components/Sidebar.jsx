import { useEffect, useState } from "react";
import { format, isToday } from "date-fns";
import api from "../lib/axios";
import useAuthStore from "../store/authStore";
import useChatStore from "../store/chatStore";
import UserAvatar from "./UserAvatar";
import CreateGroupModal from "./CreateGroupModal";
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
  const { user, logout } = useAuthStore();
  const {
    users, conversations, activeConversation,
    setUsers, setConversations, addOrUpdateConversation,
    setActiveConversation, onlineUsers, unreadCounts, clearUnreadCount,
  } = useChatStore();

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("chats"); // "chats" | "people"
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingConvs, setIsLoadingConvs] = useState(false);

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
  const getLastMessagePreview = (conv) => {
    if (!conv.lastMessage) return "No messages yet";
    const msg = conv.lastMessage;
    const senderName = msg.sender?._id === user?._id ? "You" : msg.sender?.name?.split(" ")[0];
    return `${senderName}: ${msg.text?.substring(0, 35)}${msg.text?.length > 35 ? "..." : ""}`;
  };

  // Filter conversations by search term
  const filteredConversations = conversations.filter((conv) =>
    getConvName(conv).toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter users by search term
  const filteredUsers = users.filter((u) =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleLogout = () => {
    console.log("🚪 Logging out — disconnecting socket...");

    // Prevent Socket.IO from reconnecting after logout.
    socket.io.opts.reconnection = false;

    // Remove the authentication token from the socket.
    socket.auth = {};

    // Disconnect the current socket.
    if (socket.connected || socket.active) {
      socket.disconnect();
    }

    // Clear the authenticated user.
    logout();

    console.log("✅ Logout completed");
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
        w-80 h-full flex flex-col bg-white border-r border-gray-200
        transition-transform duration-300 ease-in-out
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <UserAvatar user={user} isOnline={true} size="md" />
            <div>
              <p className="font-semibold text-gray-900 text-sm leading-tight">{user?.name}</p>
              <p className="text-xs text-green-500 font-medium">Online</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* New group button */}
            <button
              onClick={() => setShowGroupModal(true)}
              title="Create group"
              className="p-2 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {/* Logout button */}
            <button
              onClick={handleLogout}
              title="Logout"
              className="p-2 hover:bg-red-50 rounded-full text-gray-500 hover:text-red-500"
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
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search..."
              className="w-full pl-9 pr-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-4 gap-1 mb-1">
          {["chats", "people"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg capitalize
                ${activeTab === tab
                  ? "bg-blue-600 text-white"
                  : "text-gray-500 hover:bg-gray-100"
                }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* ── Chats Tab ── */}
          {activeTab === "chats" && (
            <>
              {isLoadingConvs ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="text-center py-10 px-4">
                  <p className="text-gray-400 text-sm">No conversations yet.</p>
                  <p className="text-gray-400 text-xs mt-1">Go to People to start chatting!</p>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const other = getOtherParticipant(conv);
                  const isActive = activeConversation?._id === conv._id;
                  const unread = unreadCounts[conv._id] || 0;
                  const isOnline = !conv.isGroup && onlineUsers.has(other?._id);

                  return (
                    <button
                      key={conv._id}
                      onClick={() => openConversation(conv)}
                      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left
                        ${isActive ? "bg-blue-50 border-r-2 border-blue-500" : ""}`}
                    >
                      {/* Avatar */}
                      {conv.isGroup ? (
                        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                          </svg>
                        </div>
                      ) : (
                        <UserAvatar user={other} isOnline={isOnline} size="md" />
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-sm font-semibold truncate ${isActive ? "text-blue-700" : "text-gray-900"}`}>
                            {getConvName(conv)}
                          </p>
                          <span className="text-xs text-gray-400 flex-shrink-0 ml-1">
                            {formatPreviewTime(conv.updatedAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-gray-500 truncate">{getLastMessagePreview(conv)}</p>
                          {unread > 0 && (
                            <span className="ml-1 flex-shrink-0 w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center font-medium">
                              {unread > 9 ? "9+" : unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </>
          )}

          {/* ── People Tab ── */}
          {activeTab === "people" && (
            <>
              {isLoadingUsers ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">No users found</p>
              ) : (
                filteredUsers.map((u) => (
                  <button
                    key={u._id}
                    onClick={() => handleUserClick(u)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
                  >
                    <UserAvatar user={u} isOnline={onlineUsers.has(u._id)} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{u.name}</p>
                      <p className={`text-xs font-medium ${onlineUsers.has(u._id) ? "text-green-500" : "text-gray-400"}`}>
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
    </>
  );
};

export default Sidebar;
