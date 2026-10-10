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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Create Group Chat</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* Group name input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Group name</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => { setGroupName(e.target.value); setError(""); }}
              placeholder="e.g. Project Team"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Selected participants chips */}
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map((u) => (
                <span
                  key={u._id}
                  className="flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-3 py-1 rounded-full"
                >
                  {u.name}
                  <button onClick={() => toggleUser(u)} className="ml-1 hover:text-blue-900">✕</button>
                </span>
              ))}
            </div>
          )}

          {/* Search users */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Add participants <span className="text-gray-400">(min. 2)</span>
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search users..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
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
                      ${isSelected ? "bg-blue-50 border border-blue-200" : "hover:bg-gray-50"}`}
                  >
                    <UserAvatar user={u} isOnline={onlineUsers.has(u._id)} size="sm" />
                    <span className="text-sm text-gray-800">{u.name}</span>
                    {isSelected && (
                      <svg className="w-4 h-4 text-blue-600 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                );
              })}
              {filteredUsers.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-2">No users found</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-gray-600 text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
          >
            {isLoading ? "Creating..." : `Create (${selectedUsers.length})`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateGroupModal;
