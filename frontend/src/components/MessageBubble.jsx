import { format, isToday, isYesterday } from "date-fns";
import useAuthStore from "../store/authStore";
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

const MessageBubble = ({ message, isGroup = false, previousMessage = null }) => {
  const { user } = useAuthStore();
  const isOwnMessage = message.sender?._id === user?._id;

  // Group consecutive messages from the same sender
  const isSameSenderAsPrevious =
    previousMessage && previousMessage.sender?._id === message.sender?._id;

  // Check if message has been read by anyone other than sender
  const isRead =
    message.readBy?.some((id) => id !== message.sender?._id) || false;

  return (
    <div className={`flex items-end gap-2 ${isOwnMessage ? "flex-row-reverse" : "flex-row"} 
                     ${isSameSenderAsPrevious ? "mt-0.5" : "mt-3"}`}>

      {/* Avatar — only show for received messages, and only when sender changes */}
      {!isOwnMessage && (
        <div className={`flex-shrink-0 ${isSameSenderAsPrevious ? "opacity-0" : ""}`}>
          <UserAvatar user={message.sender} size="sm" showStatus={false} />
        </div>
      )}

      {/* Bubble */}
      <div className={`max-w-[70%] ${isOwnMessage ? "items-end" : "items-start"} flex flex-col`}>
        {/* Sender name — only for group chats, first message in sequence */}
        {isGroup && !isOwnMessage && !isSameSenderAsPrevious && (
          <span className="text-xs text-gray-500 font-medium mb-1 ml-3">
            {message.sender?.name}
          </span>
        )}

        <div className={`relative px-4 py-2 rounded-2xl text-sm leading-relaxed
          ${isOwnMessage
            ? "bg-blue-600 text-white rounded-br-sm"
            : "bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-sm"
          }`}
        >
          {/* Message text */}
          <p className="whitespace-pre-wrap break-words">{message.text}</p>

          {/* Timestamp + read receipt */}
          <div className={`flex items-center gap-1 mt-1 ${isOwnMessage ? "justify-end" : "justify-start"}`}>
            <span className={`text-[10px] ${isOwnMessage ? "text-blue-200" : "text-gray-400"}`}>
              {formatMessageTime(message.createdAt)}
            </span>

            {/* Read receipt ticks (only for own messages) */}
            {isOwnMessage && (
              <svg
                className={`w-3.5 h-3.5 ${isRead ? "text-blue-200" : "text-blue-300"}`}
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                {isRead ? (
                  // Double tick (read)
                  <path d="M12.354 4.354a.5.5 0 0 0-.708-.708L5 11.293 1.854 8.146a.5.5 0 1 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l7-7zm-4.208 7-.896-.897.707-.707.543.543 6.646-6.647a.5.5 0 0 1 .708.708l-7 7a.5.5 0 0 1-.708 0z" />
                ) : (
                  // Single tick (delivered)
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
