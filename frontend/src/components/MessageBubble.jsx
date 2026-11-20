import { useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import AttachmentView from "./AttachmentView";
import { attachmentLabel } from "../lib/attachmentInfo";
import useAuthStore from "../store/authStore";
import useChatStore from "../store/chatStore";
import UserAvatar from "./UserAvatar";

/**
 * MessageBubble
 * Renders a single chat message with:
 * - Right-aligned bubble for sent messages (current user)
 * - Left-aligned bubble for received messages
 * - Sender avatar and name (for group chats)
 * - Timestamp
 * - Read receipt ticks for sent messages
 *
 * Props:
 *   - message: Message object { _id, text, sender, createdAt, readBy }
 *   - isGroup: boolean — show sender name in group chats
 *   - previousMessage: previous message for grouping same-sender messages
 */

const formatMessageTime = (date) => {
  const d = new Date(date);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
};

// Must match DELETE_FOR_EVERYONE_MS on the server (48 hours).
const DELETE_FOR_EVERYONE_MS = 48 * 60 * 60 * 1000;

const MessageBubble = ({
  message,
  isGroup = false,
  previousMessage = null,
  onReply,
  onDelete,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user } = useAuthStore();
  const isOwnMessage = message.sender?._id === user?._id;

  // Messages carry only the sender's name; the picture comes from the
  // People list so it is never repeated in every message.
  const senderProfile =
    useChatStore((s) => s.users.find((u) => u._id === message.sender?._id)) ||
    message.sender;

  // Group consecutive messages from the same sender
  const isSameSenderAsPrevious =
    previousMessage && previousMessage.sender?._id === message.sender?._id;

  // Check if message has been read by anyone other than sender
  const isRead =
    message.readBy?.some((id) => id !== message.sender?._id) || false;

  // Delivered = the other person's app received it (read implies delivered).
  const isDelivered = isRead || (message.deliveredTo?.length ?? 0) > 0;
  const isDeleted = Boolean(message.deletedAt);
  const canDeleteForEveryone =
    isOwnMessage &&
    !isDeleted &&
    Date.now() - new Date(message.createdAt).getTime() <= DELETE_FOR_EVERYONE_MS;
  const quoted = message.replyTo;
  const quotedName =
    quoted && (quoted.sender?._id === user?._id ? "You" : quoted.sender?.name);
  const receiptLabel = isRead ? "Read" : isDelivered ? "Delivered" : "Sent";

  return (
    <div className={`flex items-end gap-2 ${isOwnMessage ? "flex-row-reverse" : "flex-row"} 
                     ${isSameSenderAsPrevious ? "mt-0.5" : "mt-3"}`}>

      {/* Avatar — only show for received messages, and only when sender changes */}
      {!isOwnMessage && (
        <div className={`flex-shrink-0 ${isSameSenderAsPrevious ? "opacity-0" : ""}`}>
          <UserAvatar user={senderProfile} size="sm" showStatus={false} />
        </div>
      )}

      {/* Bubble */}
      <div className={`max-w-[80%] md:max-w-[70%] min-w-0 ${isOwnMessage ? "items-end" : "items-start"} flex flex-col`}>
        {/* Sender name — only for group chats, first message in sequence */}
        {isGroup && !isOwnMessage && !isSameSenderAsPrevious && (
          <span className="text-xs text-ink-3 font-medium mb-1 ml-3">
            {senderProfile?.name || message.sender?.name}
          </span>
        )}

        <div className={`relative max-w-full px-4 py-2 rounded-2xl text-sm leading-relaxed
          ${isOwnMessage
            ? "bg-brand text-white rounded-br-sm"
            : "bg-surface text-ink shadow-sm border border-line rounded-bl-sm"
          }`}
        >
          {/* Message actions */}
          {(onReply || onDelete) && (
            <div className="absolute top-1 right-1">
              <button
                type="button"
                aria-label="Message options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className={`w-5 h-5 rounded-full flex items-center justify-center opacity-50 hover:opacity-100 ${
                  isOwnMessage ? "text-white/80 hover:bg-brand-hover" : "text-ink-3 hover:bg-surface-3"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div
                    role="menu"
                    className={`absolute top-6 ${isOwnMessage ? "right-0" : "left-0"} w-48 bg-surface border border-line rounded-lg shadow-lg z-20 py-1 text-ink-2`}
                  >
                    {onReply && !isDeleted && (
                      <button
                        role="menuitem"
                        type="button"
                        className="w-full text-left px-4 py-2 text-sm hover:bg-surface-2"
                        onClick={() => {
                          setMenuOpen(false);
                          onReply(message);
                        }}
                      >
                        Reply
                      </button>
                    )}
                    {onDelete && (
                      <button
                        role="menuitem"
                        type="button"
                        className="w-full text-left px-4 py-2 text-sm hover:bg-surface-2"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete(message, "me");
                        }}
                      >
                        Delete for me
                      </button>
                    )}
                    {onDelete && canDeleteForEveryone && (
                      <button
                        role="menuitem"
                        type="button"
                        className="w-full text-left px-4 py-2 text-sm text-danger-text hover:bg-danger-soft"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete(message, "everyone");
                        }}
                      >
                        Delete for everyone
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* The message this one replies to */}
          {quoted && (
            <div
              className={`mb-1 mr-4 overflow-hidden rounded-lg border-l-4 px-2 py-1 text-xs ${
                isOwnMessage
                  ? "bg-brand-hover/60 border-brand/40 text-white/80"
                  : "bg-surface-3 border-brand text-ink-2"
              }`}
            >
              <p className="font-semibold truncate">{quotedName || "Deleted user"}</p>
              <p className="truncate">
                {quoted.deletedAt ? "This message was deleted" : quoted.text || attachmentLabel(quoted.attachment)}
              </p>
            </div>
          )}

          {/* Message text */}
          {isDeleted ? (
            <p className={`italic ${isOwnMessage ? "text-white/80" : "text-ink-4"}`}>
              This message was deleted
            </p>
          ) : (
            <>
              {message.attachment && (
                <AttachmentView
                  conversationId={message.conversation}
                  attachment={message.attachment}
                  isOwn={isOwnMessage}
                />
              )}
              {message.text && (
                <p className="whitespace-pre-wrap break-words pr-4">{message.text}</p>
              )}
            </>
          )}

          {/* Timestamp + read receipt */}
          <div className={`flex items-center gap-1 mt-1 ${isOwnMessage ? "justify-end" : "justify-start"}`}>
            <span className={`text-[10px] ${isOwnMessage ? "text-white/70" : "text-ink-4"}`}>
              {formatMessageTime(message.createdAt)}
            </span>

            {/* Read receipt ticks (only for own messages) */}
            {isOwnMessage && (
              <svg
                className={`w-3.5 h-3.5 ${
                  isRead ? "text-emerald-300" : isDelivered ? "text-white/80" : "text-white/50"
                }`}
                fill="currentColor"
                viewBox="0 0 16 16"
                role="img"
                aria-label={receiptLabel}
              >
                <title>{receiptLabel}</title>
                {isDelivered ? (
                  // Double tick (delivered: white-ish, read: green)
                  <path d="M12.354 4.354a.5.5 0 0 0-.708-.708L5 11.293 1.854 8.146a.5.5 0 1 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l7-7zm-4.208 7-.896-.897.707-.707.543.543 6.646-6.647a.5.5 0 0 1 .708.708l-7 7a.5.5 0 0 1-.708 0z" />
                ) : (
                  // Single tick (sent)
                  <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                )}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
