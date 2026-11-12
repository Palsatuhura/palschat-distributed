import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import api from "../lib/axios";
import socket from "../lib/socket";
import useAuthStore from "../store/authStore";
import useChatStore from "../store/chatStore";
import MessageBubble from "./MessageBubble";
import UserAvatar from "./UserAvatar";

/**
 * ChatWindow
 * The main chat area showing message history and input.
 *
 * Features:
 * - Loads message history on conversation open
 * - Auto-scrolls to the latest message
 * - Sends messages via Socket.io
 * - Shows typing indicator (debounced stop_typing after 2s)
 * - Marks messages as read when opened
 * - Handles group and 1-on-1 conversations
 *
 * Props:
 *   - onMenuClick: () => void — opens sidebar on mobile
 */

// Typing debounce delay in ms
const TYPING_DEBOUNCE_MS = 2000;

// How many messages to load at a time, and how long to wait for the server
// to confirm a sent message before telling the user.
const PAGE_SIZE = 50;
const SEND_TIMEOUT_MS = 8000;

const ChatWindow = ({ onMenuClick }) => {
  // One selector per value: this component re-renders only when one of
  // these changes, not on every unrelated store update.
  const user = useAuthStore((s) => s.user);

  const activeConversation = useChatStore((s) => s.activeConversation);
  const messages = useChatStore((s) => s.messages);
  const isLoadingMessages = useChatStore((s) => s.isLoadingMessages);
  const hasMoreMessages = useChatStore((s) => s.hasMoreMessages);
  const typingUsers = useChatStore((s) => s.typingUsers);
  const onlineUsers = useChatStore((s) => s.onlineUsers);
  const setMessages = useChatStore((s) => s.setMessages);
  const prependMessages = useChatStore((s) => s.prependMessages);
  const setHasMoreMessages = useChatStore((s) => s.setHasMoreMessages);
  const addMessage = useChatStore((s) => s.addMessage);
  const setIsLoadingMessages = useChatStore((s) => s.setIsLoadingMessages);

  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Ref to the messages container for auto-scroll
  const messagesEndRef = useRef(null);
  // The scrolling box, and its height before older messages were added
  // (used to keep the reader's place when a page is inserted above).
  const scrollBoxRef = useRef(null);
  const heightBeforePrependRef = useRef(null);
  // Ref to track whether we're currently "typing"
  const isTypingRef = useRef(false);
  // Ref to clear the typing debounce timer
  const typingTimerRef = useRef(null);
  // Textarea ref for auto-resize
  const textareaRef = useRef(null);

  // ─── Join the Socket.IO conversation room ────────────────────────────────
  // ChatWindow is the single owner of conversation-room membership.
  //
  // useSocket also rejoins the active conversation after a reconnect.
  useEffect(() => {
    if (!activeConversation?._id) return;

    const conversationId = activeConversation._id;

    const joinConversation = () => {
      if (!socket.connected) return;

      console.log(
        `📨 Joining conversation room: ${conversationId}`
      );

      socket.emit(
        "join_conversation",
        conversationId
      );
    };

    if (socket.connected) {
      joinConversation();
    } else {
      socket.once(
        "connect",
        joinConversation
      );
    }

    return () => {
      socket.off(
        "connect",
        joinConversation
      );

      if (socket.connected) {
        console.log(
          `📤 Leaving conversation room: ${conversationId}`
        );

        socket.emit(
          "leave_conversation",
          conversationId
        );
      }
    };
  }, [activeConversation?._id]);

  // ─── Load message history when conversation changes ──────────────────────
  // Loads the NEWEST page. Older messages are loaded on request (button).
  useEffect(() => {
    if (!activeConversation) return;

    const conversationId = activeConversation._id;

    // If the user switches conversation while this request is running, its
    // late answer must not overwrite the new conversation's messages.
    let cancelled = false;

    const fetchMessages = async () => {
      try {
        setIsLoadingMessages(true);
        setSendError("");

        const { data } = await api.get(`/conversations/${conversationId}/messages`, {
          params: { limit: PAGE_SIZE },
        });

        if (cancelled) return;

        setMessages(data);
        // A full page means there may be older messages.
        setHasMoreMessages(data.length === PAGE_SIZE);

        // Mark messages as read (the server knows who we are)
        socket.emit("mark_read", { conversationId });
      } catch (err) {
        if (!cancelled) console.error("Fetch messages error:", err);
      } finally {
        if (!cancelled) setIsLoadingMessages(false);
      }
    };

    fetchMessages();

    return () => {
      cancelled = true;
    };
  }, [activeConversation?._id]);

  // ─── Load an older page when the user asks for it ────────────────────────
  const loadOlderMessages = async () => {
    const oldest = messages[0];

    if (!activeConversation || !oldest || isLoadingOlder) return;

    const conversationId = activeConversation._id;

    try {
      setIsLoadingOlder(true);

      const { data } = await api.get(`/conversations/${conversationId}/messages`, {
        params: { limit: PAGE_SIZE, before: oldest._id },
      });

      // Ignore the answer if the user has opened another conversation.
      if (useChatStore.getState().activeConversation?._id !== conversationId) return;

      heightBeforePrependRef.current = scrollBoxRef.current?.scrollHeight ?? null;
      prependMessages(data);
      setHasMoreMessages(data.length === PAGE_SIZE);
    } catch (err) {
      console.error("Load older messages error:", err);
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // After older messages are inserted above, keep the reader looking at the
  // same message instead of jumping to the top.
  useLayoutEffect(() => {
    const box = scrollBoxRef.current;
    const before = heightBeforePrependRef.current;

    if (box && before !== null) {
      box.scrollTop += box.scrollHeight - before;
      heightBeforePrependRef.current = null;
    }
  }, [messages]);

  // ─── Auto-scroll to bottom on NEW messages ─────────────────────────────
  // Keyed on the newest message, so inserting older messages above does not
  // pull the view down.
  const newestMessageId = messages.length ? messages[messages.length - 1]._id : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [newestMessageId]);

  // ─── Textarea auto-resize ──────────────────────────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputText]);

  // ─── Typing indicator logic ────────────────────────────────────────────
  const handleTyping = useCallback(() => {
    if (!activeConversation || !isTypingRef.current) {
      // Start typing
      isTypingRef.current = true;
      socket.emit("typing", {
        conversationId: activeConversation._id,
      });
    }

    // Reset the stop-typing timer on every keystroke
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      socket.emit("stop_typing", {
        conversationId: activeConversation._id,
      });
    }, TYPING_DEBOUNCE_MS);
  }, [activeConversation, user]);

  // Cleanup typing timer on unmount or conversation change
  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current);
      if (isTypingRef.current && activeConversation) {
        socket.emit("stop_typing", {
          conversationId: activeConversation._id,
        });
        isTypingRef.current = false;
      }
    };
  }, [activeConversation?._id]);

  // ─── Send message ──────────────────────────────────────────────────────
  // The server confirms every message (an "acknowledgement"). The text stays
  // in the box until that confirmation arrives, so a failed send is never
  // lost and can simply be sent again.
  const handleSend = () => {
    const text = inputText.trim();

    if (
      !text ||
      !activeConversation ||
      isSending
    ) {
      return;
    }

    if (!socket.connected) {
      setSendError("You are offline. Reconnecting, then try again.");

      socket.connect();

      return;
    }

    const conversationId = activeConversation._id;

    setSendError("");
    setIsSending(true);

    // Stop typing indicator
    clearTimeout(
      typingTimerRef.current
    );

    if (isTypingRef.current) {
      socket.emit(
        "stop_typing",
        {
          conversationId,
        }
      );

      isTypingRef.current = false;
    }

    // timeout(): if the server never answers, the callback receives an error
    // instead of waiting forever.
    socket
      .timeout(SEND_TIMEOUT_MS)
      .emit(
        "send_message",
        {
          conversationId,
          text,
        },
        (error, response) => {
          setIsSending(false);

          if (error) {
            setSendError(
              "No confirmation from the server. Check the chat before sending again."
            );
            return;
          }

          if (!response?.ok) {
            setSendError(
              response?.message || "Message could not be sent."
            );
            return;
          }

          // Clear the box, unless the user already started typing something else.
          setInputText((current) => (current === text ? "" : current));

          // Show it right away if its conversation is still open (the same
          // message also arrives via receive_message; the store drops the copy).
          if (
            response.message &&
            useChatStore.getState().activeConversation?._id === conversationId
          ) {
            addMessage(response.message);
          }
        }
      );
  };

  const handleKeyDown = (e) => {
    // Send on Enter (without Shift for newline)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ─── Derived display values ────────────────────────────────────────────
  // Get the other participant for 1-on-1 DMs
  const otherParticipant = activeConversation?.isGroup
    ? null
    : activeConversation?.participants?.find((p) => p._id !== user?._id);

  const conversationName = activeConversation?.isGroup
    ? activeConversation.groupName
    : otherParticipant?.name;

  const isOtherOnline = otherParticipant && onlineUsers.has(otherParticipant._id);

  // Typing users in this conversation (excluding self)
  const currentTypingUsers = activeConversation
    ? Object.entries(typingUsers[activeConversation._id] || {})
        .filter(([uid]) => uid !== user._id)
    : [];

  // ─── Empty state ───────────────────────────────────────────────────────
  if (!activeConversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-center px-4">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-4">
          <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-gray-700">Your messages</h3>
        <p className="text-gray-400 text-sm mt-1 max-w-xs">
          Select a conversation from the sidebar or go to People to start a new chat.
        </p>
        {/* Mobile: show menu button */}
        <button
          onClick={onMenuClick}
          className="mt-6 md:hidden px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
        >
          Open Contacts
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 shadow-sm">
        {/* Mobile menu button */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-2 hover:bg-gray-100 rounded-full text-gray-500"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Avatar */}
        {activeConversation.isGroup ? (
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
            </svg>
          </div>
        ) : (
          <UserAvatar user={otherParticipant} isOnline={isOtherOnline} size="md" />
        )}

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-gray-900 truncate">{conversationName}</h2>
          {activeConversation.isGroup ? (
            <p className="text-xs text-gray-500">
              {activeConversation.participants?.length} members
            </p>
          ) : (
            <p className={`text-xs font-medium ${isOtherOnline ? "text-green-500" : "text-gray-400"}`}>
              {isOtherOnline ? "Online" : "Offline"}
            </p>
          )}
        </div>
      </div>

      {/* ── Messages area ── */}
      <div ref={scrollBoxRef} className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400 text-sm">
              No messages yet. Say hello! 👋
            </p>
          </div>
        ) : (
          <>
            {hasMoreMessages && (
              <div className="flex justify-center mb-3">
                <button
                  onClick={loadOlderMessages}
                  disabled={isLoadingOlder}
                  className="text-xs text-blue-600 hover:text-blue-700 disabled:text-gray-400 px-3 py-1 rounded-full bg-white border border-gray-200"
                >
                  {isLoadingOlder ? "Loading..." : "Load older messages"}
                </button>
              </div>
            )}
            {messages.map((msg, idx) => (
              <MessageBubble
                key={msg._id}
                message={msg}
                isGroup={activeConversation.isGroup}
                previousMessage={idx > 0 ? messages[idx - 1] : null}
              />
            ))}
          </>
        )}

        {/* Typing indicator */}
        {currentTypingUsers.length > 0 && (
          <div className="flex items-end gap-2 mt-3">
            <div className="w-8 h-8 opacity-0" /> {/* Spacer for alignment */}
            <div className="bg-white border border-gray-100 shadow-sm px-4 py-2.5 rounded-2xl rounded-bl-sm">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {currentTypingUsers.map(([, name]) => name).join(", ")}{" "}
                {currentTypingUsers.length === 1 ? "is" : "are"} typing...
              </p>
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        {sendError && (
          <p role="alert" className="text-xs text-red-600 mb-2 ml-4">
            {sendError}
          </p>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 bg-gray-100 rounded-2xl px-4 py-2.5 flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                handleTyping();
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none max-h-28 leading-relaxed"
            />
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isSending}
            className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white disabled:text-gray-400
                       rounded-full flex items-center justify-center flex-shrink-0 shadow-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5 ml-4">
          Press <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">Enter</kbd> to send,{" "}
          <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">Shift+Enter</kbd> for newline
        </p>
      </div>
    </div>
  );
};

export default ChatWindow;
