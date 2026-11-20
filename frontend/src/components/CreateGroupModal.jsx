import { useState } from "react";
import api from "../lib/axios";
import useChatStore from "../store/chatStore";
import useAuthStore from "../store/authStore";
import UserAvatar from "./UserAvatar";

/**
 * CreateGroupModal
 * A modal dialog for creating a new group chat.
 * Users can:
 *   1. Enter a group name
 *   2. Search and select multiple participants
 *   3. Submit to create the group conversation
 *
 * Props:
 *   - onClose: function to close the modal
 */
const CreateGroupModal = ({ onClose }) => {
  const { users, addOrUpdateConversation, setActiveConversation, onlineUsers } = useChatStore();
  const { user: currentUser } = useAuthStore();

  const [groupName, setGroupName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Filter users by search term
  const filteredUsers = users.filter((u) =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleUser = (user) => {
    setSelectedUsers((prev) =>
      prev.find((u) => u._id === user._id)
        ? prev.filter((u) => u._id !== user._id)
        : [...prev, user]
    );
  };

  const handleCreate = async () => {
    if (!groupName.trim()) return setError("Please enter a group name");
    if (selectedUsers.length < 2) return setError("Select at least 2 participants");

    try {
      setIsLoading(true);
      const { data } = await api.post("/conversations", {
        isGroup: true,
        groupName: groupName.trim(),
        participantIds: selectedUsers.map((u) => u._id),
      });
      addOrUpdateConversation(data);
      setActiveConversation(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create group");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="text-lg font-bold text-ink">Create Group Chat</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-3 rounded-full text-ink-3"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Error */}
          {error && (
            <div className="bg-danger-soft border border-danger-line text-danger-text text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* Group name input */}
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1">Group name</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => { setGroupName(e.target.value); setError(""); }}
              placeholder="e.g. Project Team"
              className="w-full px-3 py-2 border border-line-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          {/* Selected participants chips */}
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map((u) => (
                <span
                  key={u._id}
                  className="flex items-center gap-1 bg-brand-soft text-brand-text text-xs px-3 py-1 rounded-full"
                >
                  {u.name}
                  <button onClick={() => toggleUser(u)} className="ml-1 hover:text-brand-text">✕</button>
                </span>
              ))}
            </div>
          )}

          {/* Search users */}
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1">
              Add participants <span className="text-ink-4">(min. 2)</span>
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search users..."
              className="w-full px-3 py-2 border border-line-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand mb-2"
            />

            {/* User list */}
            <div className="max-h-48 overflow-y-auto space-y-1 scrollbar-thin">
              {filteredUsers.map((u) => {
                const isSelected = !!selectedUsers.find((s) => s._id === u._id);
                return (
                  <div
                    key={u._id}
                    onClick={() => { toggleUser(u); setError(""); }}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer
                      ${isSelected ? "bg-brand-soft border border-brand/40" : "hover:bg-surface-2"}`}
                  >
                    <UserAvatar user={u} isOnline={onlineUsers.has(u._id)} size="sm" />
                    <span className="text-sm text-ink">{u.name}</span>
                    {isSelected && (
                      <svg className="w-4 h-4 text-brand-text ml-auto" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                );
              })}
              {filteredUsers.length === 0 && (
                <p className="text-sm text-ink-4 text-center py-2">No users found</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-line rounded-lg text-ink-2 text-sm font-medium hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-brand hover:bg-brand-hover disabled:bg-brand/50 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
          >
            {isLoading ? "Creating..." : `Create (${selectedUsers.length})`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateGroupModal;
