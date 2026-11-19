import { useRef, useState } from "react";
import api from "../lib/axios";
import { imageFileToAvatar } from "../lib/image";
import useAuthStore from "../store/authStore";
import UserAvatar from "./UserAvatar";

const MAX_ABOUT = 140;

/**
 * ProfileModal
 * Lets the logged-in user change their picture and "about" line.
 * The picture is shrunk in the browser first (see lib/image.js).
 */
const ProfileModal = ({ onClose }) => {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  const fileRef = useRef(null);
  const [avatar, setAvatar] = useState(user?.avatar || "");
  const [name, setName] = useState(user?.name || "");
  const [about, setAbout] = useState(user?.about || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow choosing the same file again
    if (!file) return;
    setError("");
    try {
      setAvatar(await imageFileToAvatar(file));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSave = async () => {
    setError("");
    if (name.trim().length < 2) {
      setError("Your name must be at least 2 characters.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.patch("/users/me", { name, avatar, about });
      updateUser({ name: data.name, avatar: data.avatar, about: data.about });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black bg-opacity-40 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Your profile"
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Your profile</h2>

        <div className="flex flex-col items-center gap-3">
          <UserAvatar user={{ ...user, avatar }} size="xl" showStatus={false} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
            >
              Change picture
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
            onChange={handleFile}
          />
        </div>

        <label className="block text-sm font-medium text-gray-700 mt-4 mb-1" htmlFor="profile-name">
          Name
        </label>
        <input
          id="profile-name"
          type="text"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-400 mt-1">Email: {user?.email} (cannot be changed here)</p>

        <label className="block text-sm font-medium text-gray-700 mt-3 mb-1" htmlFor="about">
          About
        </label>
        <textarea
          id="about"
          rows={2}
          maxLength={MAX_ABOUT}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="Say something about yourself"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <p className="text-right text-xs text-gray-400">{about.length}/{MAX_ABOUT}</p>

        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
