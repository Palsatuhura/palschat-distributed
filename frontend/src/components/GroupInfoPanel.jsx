import { useMemo, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import api from "../lib/axios";
import { adminIdsOf, isAdmin, memberIds } from "../lib/groups";
import { imageFileToAvatar } from "../lib/image";
import useAuthStore from "../store/authStore";
import useChatStore from "../store/chatStore";
import GroupAvatar from "./GroupAvatar";
import UserAvatar from "./UserAvatar";

const MAX_NAME = 50;
const MAX_DESCRIPTION = 200;

const lastSeenText = (person) => {
  if (!person?.lastSeen) return "Offline";
  const when = new Date(person.lastSeen);
  if (Number.isNaN(when.getTime())) return "Offline";
  return `Last seen ${formatDistanceToNow(when, { addSuffix: true })}`;
};

/**
 * GroupInfoPanel
 * Details of a group, and, for admins, the tools to manage it:
 *   - change the name, picture and description
 *   - add people, remove people
 *   - make someone an admin, or take admin away
 * Anyone can leave the group. The server enforces every rule again; hiding
 * buttons here is only for convenience.
 */
const GroupInfoPanel = ({ conversationId, onClose }) => {
  const me = useAuthStore((s) => s.user);
  const users = useChatStore((s) => s.users);
  const onlineUsers = useChatStore((s) => s.onlineUsers);
  const addOrUpdateConversation = useChatStore((s) => s.addOrUpdateConversation);
  const removeConversation = useChatStore((s) => s.removeConversation);

  // Read the group from the store, so live changes made by other admins show.
  const group = useChatStore(
    (s) =>
      s.conversations.find((c) => c._id === conversationId) ||
      (s.activeConversation?._id === conversationId ? s.activeConversation : null)
  );

  const fileRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState("");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const participants = group?.participants || [];
  const adminIds = useMemo(() => adminIdsOf(group), [group]);
  const iAmAdmin = isAdmin(group, me?._id);
  const isOnline = (id) => id === me?._id || onlineUsers.has(id);

  // People who could still be added.
  const inGroup = useMemo(() => new Set(memberIds(group)), [group]);
  const candidates = users.filter(
    (u) =>
      !inGroup.has(String(u._id).toLowerCase()) &&
      u.name.toLowerCase().includes(search.toLowerCase())
  );

  // Run one server call; show its error message if it fails.
  const run = async (call) => {
    setError("");
    setBusy(true);
    try {
      return await call();
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startEditing = () => {
    setName(group.groupName || "");
    setDescription(group.groupDescription || "");
    setAvatar(group.groupAvatar || "");
    setError("");
    setEditing(true);
  };

  const pickPicture = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      setAvatar(await imageFileToAvatar(file));
    } catch (err) {
      setError(err.message);
    }
  };

  const saveEdits = async () => {
    if (!name.trim()) return setError("The group needs a name");
    const data = await run(async () => {
      const res = await api.patch(`/conversations/${group._id}/group`, {
        groupName: name,
        groupDescription: description,
        groupAvatar: avatar,
      });
      return res.data;
    });
    if (data) {
      addOrUpdateConversation(data);
      setEditing(false);
    }
  };

  const addPeople = async () => {
    if (picked.length === 0) return;
    const data = await run(async () => {
      const res = await api.post(`/conversations/${group._id}/members`, { userIds: picked });
      return res.data;
    });
    if (data) {
      addOrUpdateConversation(data);
      setPicked([]);
      setSearch("");
      setAdding(false);
    }
  };

  const removePerson = async (person) => {
    if (!window.confirm(`Remove ${person.name} from this group?`)) return;
    const data = await run(async () => (await api.delete(`/conversations/${group._id}/members/${person._id}`)).data);
    if (data) addOrUpdateConversation(data);
  };

  const changeAdmin = async (person, makeAdmin) => {
    const data = await run(async () =>
      makeAdmin
        ? (await api.put(`/conversations/${group._id}/admins/${person._id}`)).data
        : (await api.delete(`/conversations/${group._id}/admins/${person._id}`)).data
    );
    if (data) addOrUpdateConversation(data);
  };

  const leave = async () => {
    if (!window.confirm("Leave this group? You will stop receiving its messages.")) return;
    const data = await run(async () => (await api.delete(`/conversations/${group._id}/members/${me._id}`)).data);
    if (data) {
      removeConversation(group._id);
      onClose();
    }
  };

  // The group disappeared (for example an admin removed me).
  if (!group) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black bg-opacity-40 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[88vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Group info"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Group info</h2>
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

        {editing ? (
          <div className="flex flex-col items-center gap-3">
            <GroupAvatar avatar={avatar} size="xl" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
              >
                Change icon
              </button>
              {avatar && (
                <button
                  type="button"
                  onClick={() => setAvatar("")}
                  className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={pickPicture}
            />

            <input
              type="text"
              value={name}
              maxLength={MAX_NAME}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              aria-label="Group name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              rows={2}
              value={description}
              maxLength={MAX_DESCRIPTION}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Group description (optional)"
              aria-label="Group description"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />

            <div className="flex justify-end gap-2 w-full">
              <button
                type="button"
                onClick={() => { setEditing(false); setError(""); }}
                className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdits}
                disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              >
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <GroupAvatar avatar={group.groupAvatar} size="xl" />
            <p className="text-xl font-semibold text-gray-900 mt-3 break-words max-w-full">
              {group.groupName || "Group"}
            </p>
            <p className="text-sm text-gray-500">Group · {participants.length} members</p>
            {group.createdAt && !Number.isNaN(new Date(group.createdAt).getTime()) && (
              <p className="text-xs text-gray-400 mt-1">
                Created {format(new Date(group.createdAt), "d MMM yyyy")}
              </p>
            )}
            {group.groupDescription && (
              <p className="text-sm text-gray-600 mt-3 break-words max-w-full">{group.groupDescription}</p>
            )}
            {iAmAdmin && (
              <button
                type="button"
                onClick={startEditing}
                className="mt-3 px-3 py-1.5 text-sm rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
              >
                Edit group
              </button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600 mt-3 text-center">{error}</p>}

        <div className="flex items-center justify-between mt-5 mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Members ({participants.length})</h3>
          {iAmAdmin && !adding && (
            <button
              type="button"
              onClick={() => { setAdding(true); setError(""); }}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              + Add people
            </button>
          )}
        </div>

        {adding && (
          <div className="border border-gray-200 rounded-xl p-3 mb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people"
              aria-label="Search people to add"
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <ul className="max-h-40 overflow-y-auto mt-2">
              {candidates.length === 0 ? (
                <li className="text-xs text-gray-400 py-2 text-center">No one else to add.</li>
              ) : (
                candidates.map((u) => (
                  <li key={u._id}>
                    <label className="flex items-center gap-2 py-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={picked.includes(u._id)}
                        onChange={() =>
                          setPicked((prev) =>
                            prev.includes(u._id) ? prev.filter((x) => x !== u._id) : [...prev, u._id]
                          )
                        }
                      />
                      <UserAvatar user={u} size="sm" showStatus={false} />
                      <span className="text-sm text-gray-800 truncate">{u.name}</span>
                    </label>
                  </li>
                ))
              )}
            </ul>
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => { setAdding(false); setPicked([]); setSearch(""); }}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addPeople}
                disabled={busy || picked.length === 0}
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              >
                {busy ? "Adding..." : `Add${picked.length ? ` (${picked.length})` : ""}`}
              </button>
            </div>
          </div>
        )}

        <ul className="divide-y divide-gray-100">
          {participants.map((p) => {
            const personIsAdmin = adminIds.includes(String(p._id).toLowerCase());
            const isMe = p._id === me?._id;
            return (
              <li key={p._id} className="flex items-center gap-3 py-2">
                <UserAvatar user={p} isOnline={isOnline(p._id)} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {p.name}
                    {isMe && <span className="text-gray-400"> (you)</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {p.about || (isOnline(p._id) ? "Online" : lastSeenText(p))}
                  </p>
                  {iAmAdmin && !isMe && (
                    <div className="flex gap-3 mt-0.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => changeAdmin(p, !personIsAdmin)}
                        className="text-xs text-blue-600 hover:text-blue-700 disabled:text-gray-400"
                      >
                        {personIsAdmin ? "Remove admin" : "Make admin"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => removePerson(p)}
                        className="text-xs text-red-600 hover:text-red-700 disabled:text-gray-400"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
                {personIsAdmin && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5 flex-shrink-0">
                    Admin
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={leave}
          disabled={busy}
          className="w-full mt-5 px-4 py-2 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:text-gray-400"
        >
          Leave group
        </button>
      </div>
    </div>
  );
};

export default GroupInfoPanel;
