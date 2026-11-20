import { useRef, useState } from "react";
import api from "../lib/axios";
import { imageFileToAvatar } from "../lib/image";
import useAuthStore from "../store/authStore";
import UserAvatar from "./UserAvatar";
import GenderPicker from "./GenderPicker";
import { genderOf } from "../lib/gender";

const MAX_ABOUT = 140;

/**
 * ProfileModal
 * Lets the logged-in user change their picture and "about" line.
 * The picture is shrunk in the browser first (see lib/image.js).
 */
const ProfileModal = ({ onClose, onOpenSecurity }) => {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  const fileRef = useRef(null);
  const [avatar, setAvatar] = useState(user?.avatar || "");
  const [name, setName] = useState(user?.name || "");
  const [gender, setGender] = useState(genderOf(user));
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
      const { data } = await api.patch("/users/me", { name, avatar, gender, about });
      updateUser({ name: data.name, avatar: data.avatar, gender: data.gender, about: data.about });
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
        className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Your profile"
      >
        <h2 className="text-lg font-semibold text-ink mb-4">Your profile</h2>

        <div className="flex flex-col items-center gap-3">
          <UserAvatar user={{ ...user, avatar, gender }} size="xl" showStatus={false} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 text-sm rounded-lg bg-brand-soft text-brand-text hover:bg-brand-soft"
            >
              Change picture
            </button>
            {avatar && (
              <button
                type="button"
                onClick={() => setAvatar("")}
                className="px-3 py-1.5 text-sm rounded-lg bg-surface-3 text-ink-2 hover:bg-surface-4"
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

        <label className="block text-sm font-medium text-ink-2 mt-4 mb-1" htmlFor="profile-name">
          Name
        </label>
        <input
          id="profile-name"
          type="text"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-line-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <p className="text-xs text-ink-4 mt-1">Email: {user?.email} (cannot be changed here)</p>

        <span className="block text-sm font-medium text-ink-2 mt-3 mb-1">Gender</span>
        <GenderPicker value={gender} onChange={setGender} name="profile-gender" />

        <label className="block text-sm font-medium text-ink-2 mt-3 mb-1" htmlFor="about">
          About
        </label>
        <textarea
          id="about"
          rows={2}
          maxLength={MAX_ABOUT}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="Say something about yourself"
          className="w-full border border-line-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-none"
        />
        <p className="text-right text-xs text-ink-4">{about.length}/{MAX_ABOUT}</p>

        {error && <p className="text-sm text-danger-text mt-2">{error}</p>}

        {onOpenSecurity && (
          <button
            type="button"
            onClick={onOpenSecurity}
            className="mt-3 text-sm text-brand-text hover:text-brand-text"
          >
            Password and devices
          </button>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-ink-2 hover:bg-surface-3"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-brand text-white hover:bg-brand-hover disabled:bg-brand/50"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
