import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import api from "../lib/axios";
import { endSession } from "../lib/session";
import ConfirmDialog from "./ConfirmDialog";

const ago = (value) => {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "";
  return formatDistanceToNow(when, { addSuffix: true });
};

/**
 * SecurityModal
 * Password and logins:
 *   - change your password (other devices are signed out)
 *   - see every device that is signed in, and remove any of them
 *   - sign out of all devices
 * The server checks every rule again; this screen only asks.
 */
const SecurityModal = ({ onClose }) => {
  const [sessions, setSessions] = useState(null);
  const [listError, setListError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwDone, setPwDone] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteWord, setDeleteWord] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/sessions");
      setSessions(data);
      setListError("");
    } catch (err) {
      setListError(err.response?.data?.message || "Could not load your devices.");
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const removeDevice = async (session) => {
    if (!window.confirm(`Sign out "${session.device}"?`)) return;
    setBusyId(session.id);
    try {
      await api.delete(`/auth/sessions/${session.id}`);
      await loadSessions();
    } catch (err) {
      setListError(err.response?.data?.message || "Could not sign that device out.");
    } finally {
      setBusyId("");
    }
  };

  const signOutEverywhere = async () => {
    if (!window.confirm("Sign out of ALL devices, including this one?")) return;
    setBusyId("all");
    try {
      await api.post("/auth/logout-all");
      endSession("ended");
    } catch (err) {
      setListError(err.response?.data?.message || "Could not sign out everywhere.");
      setBusyId("");
    }
  };

  const deleteAccount = async () => {
    setDeleteError("");
    if (deleteWord !== "DELETE") return setDeleteError("Type DELETE in capital letters.");
    if (!deletePassword) return setDeleteError("Please enter your password.");
    setDeleteBusy(true);
    try {
      await api.delete("/users/me", { data: { password: deletePassword, confirm: "DELETE" } });
      endSession("deleted");
    } catch (err) {
      setDeleteError(err.response?.data?.message || "Could not delete the account.");
      setDeleteBusy(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setPwError("");
    setPwDone("");

    if (!currentPassword || !newPassword) {
      return setPwError("Please fill in both passwords.");
    }
    if (newPassword.length < 8) {
      return setPwError("The new password must be at least 8 characters.");
    }
    if (newPassword !== confirmPassword) {
      return setPwError("The new passwords do not match.");
    }

    setPwBusy(true);
    try {
      const { data } = await api.post("/auth/change-password", { currentPassword, newPassword });
      setPwDone(
        data.endedOtherSessions > 0
          ? `Password changed. ${data.endedOtherSessions} other device(s) were signed out.`
          : "Password changed."
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      loadSessions();
    } catch (err) {
      setPwError(err.response?.data?.message || "Could not change the password.");
    } finally {
      setPwBusy(false);
    }
  };

  const input =
    "w-full border border-line-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand";

  return (
    <div
      className="fixed inset-0 z-50 bg-black bg-opacity-40 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[88vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Password and devices"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-ink">Password and devices</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-full hover:bg-surface-3 text-ink-3"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <h3 className="text-sm font-semibold text-ink-2 mb-2">Change password</h3>
        <form onSubmit={changePassword} className="space-y-2">
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            aria-label="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={input}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="New password (8+ characters)"
            aria-label="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={input}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Repeat the new password"
            aria-label="Repeat the new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={input}
          />
          {pwError && <p className="text-sm text-danger-text">{pwError}</p>}
          {pwDone && <p className="text-sm text-success-text">{pwDone}</p>}
          <button
            type="submit"
            disabled={pwBusy}
            className="px-4 py-2 text-sm rounded-lg bg-brand text-white hover:bg-brand-hover disabled:bg-brand/50"
          >
            {pwBusy ? "Saving..." : "Change password"}
          </button>
        </form>

        <h3 className="text-sm font-semibold text-ink-2 mt-6 mb-2">Where you are signed in</h3>
        {listError && <p className="text-sm text-danger-text mb-2">{listError}</p>}
        {sessions === null && !listError && <p className="text-sm text-ink-4">Loading...</p>}
        <ul className="divide-y divide-line">
          {(sessions || []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink truncate">
                  {s.device}
                  {s.current && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-success-text bg-success-soft border border-success-line rounded px-1.5 py-0.5">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-3">Active {ago(s.lastSeenAt)}</p>
              </div>
              {!s.current && (
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => removeDevice(s)}
                  className="text-xs text-danger-text hover:text-danger-text disabled:text-ink-4"
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={signOutEverywhere}
          disabled={busyId === "all"}
          className="w-full mt-5 px-4 py-2 text-sm rounded-lg border border-danger-line text-danger-text hover:bg-danger-soft disabled:text-ink-4"
        >
          Sign out of all devices
        </button>

        <h3 className="text-sm font-semibold text-danger-text mt-6 mb-1">Delete my account</h3>
        <p className="text-xs text-ink-3 mb-2">
          This cannot be undone. You leave all groups and are signed out everywhere. Your old
          messages stay for the other people, shown as "Deleted user".
        </p>
        <button
          type="button"
          onClick={() => {
            setDeleteError("");
            setShowDelete(true);
          }}
          className="w-full px-4 py-2 text-sm rounded-lg bg-danger text-white hover:bg-danger-hover"
        >
          Delete my account
        </button>
      </div>

      {showDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            title="Delete your account?"
            message={
              <span className="block space-y-2">
                <span className="block">Enter your password and type DELETE to confirm.</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  aria-label="Your password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className={input}
                />
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="Type DELETE"
                  aria-label="Type DELETE"
                  value={deleteWord}
                  onChange={(e) => setDeleteWord(e.target.value)}
                  className={input}
                />
              </span>
            }
            confirmLabel="Delete forever"
            danger
            busy={deleteBusy}
            error={deleteError}
            onConfirm={deleteAccount}
            onCancel={() => {
              setShowDelete(false);
              setDeletePassword("");
              setDeleteWord("");
            }}
          />
        </div>
      )}
    </div>
  );
};

export default SecurityModal;
