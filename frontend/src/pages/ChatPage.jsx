import { useState } from "react";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import useSocket from "../hooks/useSocket";
import useChatStore from "../store/chatStore";

/**
 * ChatPage — Main Application Layout
 *
 * Renders the two-panel chat layout:
 *   [Sidebar (contacts/conversations)] + [ChatWindow (messages)]
 *
 * Responsive behavior:
 *   - Desktop (md+): both panels visible side by side
 *   - Mobile: sidebar is hidden by default, shown as a slide-in drawer
 *     triggered by the hamburger menu button in ChatWindow's header
 *
 * This is also where the useSocket hook is mounted to manage the
 * Socket.io connection for the entire authenticated session.
 */
const ChatPage = () => {
  // Mobile: whether the sidebar drawer is open
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Initialize Socket.io connection and register all event handlers
  useSocket();

  // On a phone only one panel fits. With no chat open, the chat list IS the
  // screen; once a chat is open, it takes the screen and the back arrow in
  // its header brings the list back.
  const hasActiveConversation = useChatStore((s) => Boolean(s.activeConversation));

  return (
    <div
      className="h-screen flex overflow-hidden bg-gray-100"
      style={{ height: "100dvh" }}
    >
      {/* ── Sidebar ── */}
      <Sidebar
        isMobileOpen={isMobileSidebarOpen || !hasActiveConversation}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
        onConversationSelect={() => setIsMobileSidebarOpen(false)}
      />

      {/* ── Chat Window ── */}
      <ChatWindow
        onMenuClick={() => setIsMobileSidebarOpen(true)}
      />
    </div>
  );
};

export default ChatPage;
