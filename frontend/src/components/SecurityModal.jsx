import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import api from "../lib/axios";
import { endSession } from "../lib/session";

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
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div
      className="fixed inset-0 z-50 bg-black bg-opacity-40 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[88vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Password and devices"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Password and devices</h2>
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

        <h3 className="text-sm font-semibold text-gray-700 mb-2">Change password</h3>
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
          {pwError && <p className="text-sm text-red-600">{pwError}</p>}
          {pwDone && <p className="text-sm text-green-600">{pwDone}</p>}
          <button
            type="submit"
            disabled={pwBusy}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
          >
            {pwBusy ? "Saving..." : "Change password"}
          </button>
        </form>

        <h3 className="text-sm font-semibold text-gray-700 mt-6 mb-2">Where you are signed in</h3>
        {listError && <p className="text-sm text-red-600 mb-2">{listError}</p>}
        {sessions === null && !listError && <p className="text-sm text-gray-400">Loading...</p>}
        <ul className="divide-y divide-gray-100">
          {(sessions || []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {s.device}
                  {s.current && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500">Active {ago(s.lastSeenAt)}</p>
              </div>
              {!s.current && (
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => removeDevice(s)}
                  className="text-xs text-red-600 hover:text-red-700 disabled:text-gray-400"
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
          className="w-full mt-5 px-4 py-2 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:text-gray-400"
        >
          Sign out of all devices
        </button>
      </div>
    </div>
  );
};

export default SecurityModal;
