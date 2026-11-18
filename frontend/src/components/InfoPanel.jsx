import { format, formatDistanceToNow } from "date-fns";
import useAuthStore from "../store/authStore";
import useChatStore from "../store/chatStore";
import UserAvatar from "./UserAvatar";

const lastSeenText = (person) => {
  if (!person?.lastSeen) return "Offline";
  const when = new Date(person.lastSeen);
  if (Number.isNaN(when.getTime())) return "Offline";
  return `Last seen ${formatDistanceToNow(when, { addSuffix: true })}`;
};

/**
 * InfoPanel
 * Shows details about the open conversation:
 *   - one-to-one chat: the contact's picture, name, status and about line
 *   - group chat: the group name, member count, creation date and members
 */
const InfoPanel = ({ conversation, onClose }) => {
  const me = useAuthStore((s) => s.user);
  const onlineUsers = useChatStore((s) => s.onlineUsers);

  const participants = conversation?.participants || [];
  const isGroup = Boolean(conversation?.isGroup);
  const other = isGroup ? null : participants.find((p) => p._id !== me?._id);

  const isOnline = (id) => id === me?._id || onlineUsers.has(id);

  return (
    <div
      className="fixed inset-0 z-50 bg-black bg-opacity-40 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isGroup ? "Group info" : "Contact info"}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {isGroup ? "Group info" : "Contact info"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-full hover:bg-gray-100 text-gray-500"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isGroup ? (
          <>
            <div className="flex flex-col items-center text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
                <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                </svg>
              </div>
              <p className="text-xl font-semibold text-gray-900 mt-3 break-words max-w-full">
                {conversation.groupName || conversation.name || "Group"}
              </p>
              <p className="text-sm text-gray-500">
                Group · {participants.length} members
              </p>
              {conversation.createdAt && !Number.isNaN(new Date(conversation.createdAt).getTime()) && (
                <p className="text-xs text-gray-400 mt-1">
                  Created {format(new Date(conversation.createdAt), "d MMM yyyy")}
                </p>
              )}
            </div>

            <h3 className="text-sm font-semibold text-gray-700 mt-5 mb-2">
              Members ({participants.length})
            </h3>
            <ul className="divide-y divide-gray-100">
              {participants.map((p) => (
                <li key={p._id} className="flex items-center gap-3 py-2">
                  <UserAvatar user={p} isOnline={isOnline(p._id)} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {p.name}
                      {p._id === me?._id && <span className="text-gray-400"> (you)</span>}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {p.about || (isOnline(p._id) ? "Online" : lastSeenText(p))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex flex-col items-center text-center">
            <UserAvatar user={other} isOnline={other && isOnline(other._id)} size="xl" />
            <p className="text-xl font-semibold text-gray-900 mt-3">{other?.name}</p>
            <p className={`text-sm ${other && isOnline(other._id) ? "text-green-500" : "text-gray-500"}`}>
              {other && isOnline(other._id) ? "Online" : lastSeenText(other)}
            </p>

            <div className="w-full text-left mt-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">About</h3>
              <p className="text-sm text-gray-600 break-words">
                {other?.about || "No about line yet."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InfoPanel;
