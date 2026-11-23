import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import api from "../lib/axios";
import socket from "../lib/socket";
import useAuthStore from "../store/authStore";
import useChatStore from "../store/chatStore";
import MessageBubble from "./MessageBubble";
import UserAvatar from "./UserAvatar";
import InfoPanel from "./InfoPanel";
import GroupAvatar from "./GroupAvatar";
import ConfirmDialog from "./ConfirmDialog";
import { dayLabel, isSameDay } from "../lib/dayLabel";
import { attemptFor, shouldRetry } from "../lib/sendRetry";
import { isNearBottom, shouldFollowNewMessage } from "../lib/scrollRules";
import { SkeletonMessages } from "./Skeleton";
import { ACCEPT, formatSize, previewText } from "../lib/attachmentInfo";
import { prepareFile, uploadAttachment } from "../lib/attachments";

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
  const [showInfo, setShowInfo] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // "clear" | "delete" | null
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [pendingFile, setPendingFile] = useState(null); // { blob, name, uploaded? }
  const [uploadPercent, setUploadPercent] = useState(null);
  const fileInputRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { message, scope }

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

  // ─── Mark as read when the person comes back to this tab ────────────────
  // Messages that arrive while the tab is hidden stay unread until it is
  // shown again.
  useEffect(() => {
    if (!activeConversation?._id) return;

    const conversationId = activeConversation._id;

    const markReadIfVisible = () => {
      if (document.visibilityState === "visible" && socket.connected) {
        socket.emit("mark_read", { conversationId });
      }
    };

    document.addEventListener("visibilitychange", markReadIfVisible);
    window.addEventListener("focus", markReadIfVisible);

    return () => {
      document.removeEventListener("visibilitychange", markReadIfVisible);
      window.removeEventListener("focus", markReadIfVisible);
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
  const newestIsMine =
    messages.length > 0 &&
    (messages[messages.length - 1].sender?._id ?? messages[messages.length - 1].sender) === user?._id;

  // Is the reader at the bottom? Kept in a ref (for the effect below) and in
  // state (to show or hide the "jump to latest" button).
  const attemptRef = useRef(null); // label of the message being sent
  const nearBottomRef = useRef(true);
  const openedChatRef = useRef(null);
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(0);

  const handleScroll = () => {
    const box = scrollBoxRef.current;
    if (!box) return;
    const near = isNearBottom(box.scrollHeight, box.scrollTop, box.clientHeight);
    nearBottomRef.current = near;
    setShowJump(!near);
    if (near) setNewBelow(0);
  };

  const jumpToLatest = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setNewBelow(0);
  };

  useEffect(() => {
    const chatId = activeConversation?._id ?? null;
    const firstLoad = openedChatRef.current !== chatId;
    if (newestMessageId === null) return;
    openedChatRef.current = chatId;

    if (
      shouldFollowNewMessage({
        firstLoad,
        isMine: newestIsMine,
        wasNearBottom: nearBottomRef.current,
      })
    ) {
      messagesEndRef.current?.scrollIntoView({ behavior: firstLoad ? "auto" : "smooth" });
    } else {
      // Reading older messages: do not pull the view away.
      setNewBelow((n) => n + 1);
      setShowJump(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestMessageId]);

  // A different chat starts at the bottom.
  useEffect(() => {
    nearBottomRef.current = true;
    openedChatRef.current = null;
    setShowJump(false);
    setNewBelow(0);
  }, [activeConversation?._id]);

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
  const handleSend = async () => {
    const text = inputText.trim();

    if (
      (!text && !pendingFile) ||
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

    // A picture or file goes up first; the message then names it. If sending
    // fails afterwards, the upload is kept so a retry does not repeat it.
    let attachmentId = pendingFile?.uploaded?.id;
    if (pendingFile && !attachmentId) {
      try {
        setUploadPercent(0);
        const uploaded = await uploadAttachment(
          conversationId,
          pendingFile.blob,
          pendingFile.name,
          setUploadPercent
        );
        attachmentId = uploaded.id;
        setPendingFile((p) => (p ? { ...p, uploaded } : p));
      } catch (err) {
        setSendError(err.response?.data?.message || "The file could not be uploaded. Please try again.");
        setIsSending(false);
        setUploadPercent(null);
        return;
      }
      setUploadPercent(null);
    }

    // The same label goes with every attempt at this message, so a retry
    // after a dropped connection cannot create a second copy.
    attemptRef.current = attemptFor(attemptRef.current, {
      conversationId,
      text,
      attachmentId,
      replyTo: replyingTo?._id,
    });
    const { clientId } = attemptRef.current;
    const payload = {
      conversationId,
      text,
      clientId,
      ...(attachmentId ? { attachment: attachmentId } : {}),
      ...(replyingTo ? { replyTo: replyingTo._id } : {}),
    };

    // timeout(): if the server never answers, the callback receives an error
    // instead of waiting forever. We then try again (safe, see above).
    const attemptSend = (attemptNumber) => {
      socket.timeout(SEND_TIMEOUT_MS).emit("send_message", payload, (error, response) => {
        if (error) {
          if (shouldRetry(attemptNumber)) {
            attemptSend(attemptNumber + 1);
            return;
          }
          setIsSending(false);
          setSendError(
            "No answer from the server. Check your connection and press send again; your message will not be sent twice."
          );
          return;
        }

        setIsSending(false);

        if (!response?.ok) {
          setSendError(response?.message || "Message could not be sent.");
          return;
        }

        // Done: the next message gets a new label.
        attemptRef.current = null;

        // Clear the box, unless the user already started typing something else.
        setInputText((current) => (current === text ? "" : current));
        setReplyingTo(null);
        setPendingFile(null);

        // Show it right away if its conversation is still open (the same
        // message also arrives via receive_message; the store drops the copy).
        if (useChatStore.getState().activeConversation?._id === conversationId) {
          addMessage(response.message);
        }
      });
    };
    attemptSend(1);
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

  const blockedIds = useChatStore((s) => s.blockedIds);
  const iBlockedThem = Boolean(otherParticipant && blockedIds.includes(otherParticipant._id));
  const canBlock = Boolean(otherParticipant) && !otherParticipant.deletedAt;

  const savePref = async (patch) => {
    if (!activeConversation) return;
    setSendError("");
    try {
      const { data } = await api.post(`/conversations/${activeConversation._id}/prefs`, patch);
      const { conversationId, ...applied } = data;
      useChatStore.getState().applyConversationPrefs(conversationId, applied);
    } catch (err) {
      setSendError(err.response?.data?.message || "Could not save that setting.");
    }
  };

  const unblock = async () => {
    if (!otherParticipant) return;
    setSendError("");
    try {
      const { data } = await api.delete(`/users/${otherParticipant._id}/block`);
      useChatStore.getState().setBlockedIds(data.blocked);
    } catch (err) {
      setSendError(err.response?.data?.message || "Could not unblock.");
    }
  };

  const isOtherOnline = otherParticipant && onlineUsers.has(otherParticipant._id);

  // Typing users in this conversation (excluding self)
  const currentTypingUsers = activeConversation
    ? Object.entries(typingUsers[activeConversation._id] || {})
        .filter(([uid]) => uid !== user._id)
    : [];

  // Another chat means another reply target.
  useEffect(() => {
    setReplyingTo(null);
    setPendingDelete(null);
    setPendingFile(null);
    setUploadPercent(null);
  }, [activeConversation?._id]);

  const chooseFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again
    if (!file) return;
    setSendError("");
    try {
      const { blob, name } = await prepareFile(file);
      setPendingFile({ blob, name });
    } catch (err) {
      setSendError(err.message || "Could not use that file.");
    }
  };

  const runDeleteMessage = async () => {
    if (!pendingDelete || !activeConversation) return;
    const { message, scope } = pendingDelete;
    setActionBusy(true);
    setActionError("");
    try {
      await api.delete(
        `/conversations/${activeConversation._id}/messages/${message._id}`,
        { params: { scope } }
      );
      const store = useChatStore.getState();
      if (scope === "me") store.removeMessage(message._id);
      else store.markMessageDeleted(activeConversation._id, message._id, new Date().toISOString());
      if (replyingTo?._id === message._id) setReplyingTo(null);
      setPendingDelete(null);
    } catch (err) {
      setActionError(err.response?.data?.message || "That did not work. Please try again.");
    } finally {
      setActionBusy(false);
    }
  };

  // The other person deleted their account: this chat is read-only.
  const isReadOnly = Boolean(activeConversation?.readOnly);

  const runChatAction = async () => {
    if (!activeConversation || !confirmAction) return;
    setActionBusy(true);
    setActionError("");
    try {
      if (confirmAction === "block") {
        const { data } = await api.post(`/users/${otherParticipant._id}/block`);
        useChatStore.getState().setBlockedIds(data.blocked);
      } else if (confirmAction === "clear") {
        await api.post(`/conversations/${activeConversation._id}/clear`);
        useChatStore.getState().clearConversationMessages(activeConversation._id);
      } else {
        await api.delete(`/conversations/${activeConversation._id}`);
        useChatStore.getState().removeConversation(activeConversation._id);
      }
      setConfirmAction(null);
    } catch (err) {
      setActionError(err.response?.data?.message || "That did not work. Please try again.");
    } finally {
      setActionBusy(false);
    }
  };

  // ─── Empty state ───────────────────────────────────────────────────────
  if (!activeConversation) {
    return (
      <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-surface-2 text-center px-4">
        <div className="w-24 h-24 bg-brand-soft rounded-3xl flex items-center justify-center mb-5 shadow-soft">
          <svg className="w-12 h-12 text-brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <h3 className="text-2xl font-semibold text-ink tracking-tight">Your messages</h3>
        <p className="text-ink-4 text-sm mt-1 max-w-xs">
          Select a conversation from the sidebar or go to People to start a new chat.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-surface-2 min-w-0">
      {/* ── Header ── */}
      <div className="relative z-30 flex items-center gap-3 px-4 py-3 bg-surface/90 backdrop-blur border-b border-line">
        {/* Mobile back button: returns to the chat list */}
        <button
          onClick={onMenuClick}
          aria-label="Back to chats"
          className="md:hidden p-2 -ml-2 hover:bg-surface-3 rounded-full text-ink-3"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Avatar + name: click to see contact or group info */}
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          aria-label={activeConversation.isGroup ? "Group info" : "Contact info"}
          className="flex flex-1 min-w-0 items-center gap-3 text-left rounded-lg hover:bg-surface-2 -my-1 py-1 px-1"
        >
        {/* Avatar */}
        {activeConversation.isGroup ? (
          <GroupAvatar avatar={activeConversation.groupAvatar} size="md" />
        ) : (
          <UserAvatar user={otherParticipant} isOnline={isOtherOnline} size="md" />
        )}

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-ink truncate">{conversationName}</h2>
          {activeConversation.isGroup ? (
            <p className="text-xs text-ink-3">
              {activeConversation.participants?.length} members
            </p>
          ) : (
            <p className={`text-xs font-medium ${isOtherOnline ? "text-success-text" : "text-ink-4"}`}>
              {isOtherOnline ? "Online" : "Offline"}
            </p>
          )}
        </div>
        </button>

        {/* ⋮ menu: clear or delete this chat (only for me) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Chat options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="p-2 hover:bg-surface-3 rounded-full text-ink-3"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-48 max-h-[70vh] overflow-y-auto bg-surface border border-line rounded-lg shadow-xl z-20 py-1"
              >
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowInfo(true);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
                >
                  {activeConversation.isGroup ? "Group info" : "Contact info"}
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    savePref({ pinned: !activeConversation.pinned });
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
                >
                  {activeConversation.pinned ? "Unpin chat" : "Pin chat"}
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    savePref({ muted: !activeConversation.muted });
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
                >
                  {activeConversation.muted ? "Unmute" : "Mute"}
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    savePref({ archived: !activeConversation.archived });
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
                >
                  {activeConversation.archived ? "Unarchive" : "Archive"}
                </button>
                {canBlock && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (iBlockedThem) {
                        unblock();
                      } else {
                        setActionError("");
                        setConfirmAction("block");
                      }
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
                  >
                    {iBlockedThem ? "Unblock contact" : "Block contact"}
                  </button>
                )}
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setActionError("");
                    setConfirmAction("clear");
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
                >
                  Clear chat
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setActionError("");
                    setConfirmAction("delete");
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-danger-text hover:bg-danger-soft"
                >
                  Delete chat
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Messages area ── */}
      <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollBoxRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin"
      >
        {isLoadingMessages ? (
          <SkeletonMessages />
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-ink-4 text-sm">
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
                  className="text-xs text-brand-text hover:text-brand-text disabled:text-ink-4 px-3 py-1 rounded-full bg-surface border border-line"
                >
                  {isLoadingOlder ? "Loading..." : "Load older messages"}
                </button>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={msg._id}>
                {(idx === 0 || !isSameDay(messages[idx - 1].createdAt, msg.createdAt)) && (
                  <div className="flex justify-center my-3">
                    <span className="text-xs font-medium text-ink-3 bg-surface border border-line rounded-full px-3 py-1 shadow-sm">
                      {dayLabel(msg.createdAt)}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={msg}
                  isGroup={activeConversation.isGroup}
                  previousMessage={idx > 0 ? messages[idx - 1] : null}
                  onReply={isReadOnly ? undefined : (m) => setReplyingTo(m)}
                  onDelete={(m, scope) => {
                    setActionError("");
                    setPendingDelete({ message: m, scope });
                  }}
                />
              </div>
            ))}
          </>
        )}

        {/* Typing indicator */}
        {currentTypingUsers.length > 0 && (
          <div className="flex items-end gap-2 mt-3">
            <div className="w-8 h-8 opacity-0" /> {/* Spacer for alignment */}
            <div className="bg-surface border border-line shadow-sm px-4 py-2.5 rounded-2xl rounded-bl-sm">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-ink-4 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 bg-ink-4 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 bg-ink-4 rounded-full animate-bounce" />
              </div>
              <p className="text-xs text-ink-4 mt-1">
                {currentTypingUsers.map(([, name]) => name).join(", ")}{" "}
                {currentTypingUsers.length === 1 ? "is" : "are"} typing...
              </p>
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {showJump && (
        <button
          type="button"
          onClick={jumpToLatest}
          aria-label={newBelow > 0 ? `Jump to latest, ${newBelow} new` : "Jump to latest"}
          className="absolute bottom-4 right-6 flex items-center gap-1.5 pl-3 pr-3.5 py-2 rounded-full bg-surface border border-line shadow-pop text-sm font-medium text-ink-2 hover:bg-surface-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {newBelow > 0 ? `${newBelow} new` : "Latest"}
        </button>
      )}
      </div>

      {/* ── Input bar ── */}
      {isReadOnly ? (
        <div className="bg-surface border-t border-line px-4 py-4 text-center text-sm text-ink-3">
          This account was deleted. You can read the old messages but cannot send new ones.
        </div>
      ) : iBlockedThem ? (
        <div className="bg-surface border-t border-line px-4 py-4 text-center text-sm text-ink-3">
          You blocked {otherParticipant?.name}. Neither of you can send messages here.{" "}
          <button type="button" onClick={unblock} className="text-brand-text hover:text-brand-text font-medium">
            Unblock
          </button>
          {sendError && <p className="text-xs text-danger-text mt-2">{sendError}</p>}
        </div>
      ) : (
      <div className="bg-surface border-t border-line px-4 py-3">
        {replyingTo && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-surface-2 border-l-4 border-brand rounded-lg text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink-2 truncate">
                Replying to{" "}
                {replyingTo.sender?._id === user?._id ? "yourself" : replyingTo.sender?.name}
              </p>
              <p className="text-ink-3 truncate">{previewText(replyingTo)}</p>
            </div>
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={() => setReplyingTo(null)}
              className="p-1 rounded-full hover:bg-surface-4 text-ink-3"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {pendingFile && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-surface-2 border border-line rounded-lg text-xs">
            <span aria-hidden="true">📎</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink-2 truncate">{pendingFile.name}</p>
              <p className="text-ink-3">
                {formatSize(pendingFile.blob.size)}
                {uploadPercent !== null && ` · Uploading ${uploadPercent}%`}
              </p>
            </div>
            <button
              type="button"
              aria-label="Remove file"
              disabled={isSending}
              onClick={() => setPendingFile(null)}
              className="p-1 rounded-full hover:bg-surface-4 text-ink-3 disabled:opacity-40"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {sendError && (
          <p role="alert" className="text-xs text-danger-text mb-2 ml-4">
            {sendError}
          </p>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={chooseFile}
          />
          <button
            type="button"
            aria-label="Attach a picture or file"
            title="Attach a picture or file"
            disabled={isSending}
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-ink-3 hover:bg-surface-3 disabled:opacity-40"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <div className="flex-1 bg-surface-2 border border-line-strong rounded-2xl px-4 py-2.5 flex items-end gap-2 focus-within:ring-2 focus-within:ring-brand focus-within:border-transparent">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                handleTyping();
              }}
              onKeyDown={handleKeyDown}
              placeholder={pendingFile ? "Add a caption (optional)..." : "Type a message..."}
              rows={1}
              className="flex-1 bg-transparent text-sm text-ink placeholder-ink-4 resize-none focus:outline-none max-h-28 leading-relaxed"
            />
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={(!inputText.trim() && !pendingFile) || isSending}
            aria-label="Send message"
            className="w-10 h-10 bg-brand hover:bg-brand-hover disabled:bg-surface-4 text-white disabled:text-ink-4
                       rounded-full flex items-center justify-center flex-shrink-0 shadow-sm
                       focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-surface disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
        <p className="hidden md:block text-xs text-ink-4 mt-1.5 ml-14">
          Press <kbd className="px-1 py-0.5 bg-surface-4 rounded text-[10px]">Enter</kbd> to send,{" "}
          <kbd className="px-1 py-0.5 bg-surface-4 rounded text-[10px]">Shift+Enter</kbd> for newline
        </p>
      </div>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction === "block"
              ? `Block ${otherParticipant?.name}?`
              : confirmAction === "clear"
                ? "Clear this chat?"
                : "Delete this chat?"
          }
          message={
            confirmAction === "block"
              ? "Neither of you will be able to send messages in this chat until you unblock them. They are not told that you blocked them."
              : confirmAction === "clear"
              ? "All messages will be removed from your screen. Other people in the chat keep theirs."
              : "This chat will be removed from your list and its messages cleared for you. It comes back if someone sends a new message. Other people keep their copy."
          }
          confirmLabel={
            confirmAction === "block" ? "Block" : confirmAction === "clear" ? "Clear chat" : "Delete chat"
          }
          danger
          busy={actionBusy}
          error={actionError}
          onConfirm={runChatAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.scope === "everyone" ? "Delete for everyone?" : "Delete for me?"
          }
          message={
            pendingDelete.scope === "everyone"
              ? "The message will be erased for everyone in this chat. A note saying it was deleted stays in its place."
              : "The message will be removed from your screen only. Other people still see it."
          }
          confirmLabel="Delete"
          danger
          busy={actionBusy}
          error={actionError}
          onConfirm={runDeleteMessage}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {showInfo && (
        <InfoPanel
          conversation={activeConversation}
          onClose={() => setShowInfo(false)}
        />
      )}
    </div>
  );
};

export default ChatWindow;
