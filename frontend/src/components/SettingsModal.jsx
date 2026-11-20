import { useEffect, useState } from "react";
import { ACCENTS, THEMES, getAccent, getTheme, setAccent, setTheme } from "../lib/theme";
import UserAvatar from "./UserAvatar";
import {
  desktopPermission,
  desktopSupported,
  isDesktopOn,
  isSoundOn,
  playPing,
  setDesktopOn,
  setSoundOn,
} from "../lib/notify";
import useAuthStore from "../store/authStore";

const Switch = ({ checked, onChange, label, hint, disabled }) => (
  <div className="flex items-center justify-between gap-4 px-4 py-3">
    <div className="min-w-0">
      <p className="text-sm font-medium text-ink">{label}</p>
      {hint && <p className="text-xs text-ink-3 mt-0.5">{hint}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full flex-shrink-0 disabled:opacity-40 ${checked ? "bg-brand" : "bg-surface-4"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  </div>
);

const THEME_LABELS = { light: "Light", dark: "Dark", system: "System" };

// Colours shown on the accent buttons (the real values live in index.css).
const ACCENT_SWATCH = {
  blue: "#2563eb",
  violet: "#7c3aed",
  emerald: "#059669",
  rose: "#e11d48",
  amber: "#d97706",
};

const ThemeIcon = ({ name }) => {
  const common = { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24" };
  if (name === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={2} d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
      </svg>
    );
  }
  if (name === "dark") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M8 20h8m-4-4v4" />
    </svg>
  );
};

/**
 * SettingsModal
 * Appearance (theme and accent colour) and shortcuts to the account
 * windows. The appearance choice is remembered in this browser.
 */
const SettingsModal = ({ onClose, onOpenProfile, onOpenSecurity, onLogout }) => {
  const user = useAuthStore((s) => s.user);
  const [theme, setThemeState] = useState(getTheme());
  const [accent, setAccentState] = useState(getAccent());
  const [sound, setSoundState] = useState(isSoundOn());
  const [desktop, setDesktopState] = useState(isDesktopOn());
  const [desktopNote, setDesktopNote] = useState("");

  const toggleSound = (on) => {
    setSoundOn(on);
    setSoundState(on);
    if (on) playPing(); // lets the person hear it
  };

  const toggleDesktop = async (on) => {
    setDesktopNote("");
    const result = await setDesktopOn(on);
    setDesktopState(result);
    if (on && !result) {
      setDesktopNote(
        desktopSupported() && desktopPermission() === "denied"
          ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again."
          : "This browser does not support desktop notifications."
      );
    }
  };

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chooseTheme = (t) => {
    setTheme(t);
    setThemeState(t);
  };
  const chooseAccent = (a) => {
    setAccent(a);
    setAccentState(a);
  };

  const row = "w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-2 text-left";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-pop border border-line w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-ink">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 rounded-full text-ink-3 hover:bg-surface-3"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-5 space-y-5">
          {/* Appearance */}
          <section aria-labelledby="appearance-title">
            <h3 id="appearance-title" className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">
              Appearance
            </h3>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={theme === t}
                  onClick={() => chooseTheme(t)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-sm font-medium ${
                    theme === t
                      ? "border-brand bg-brand-soft text-brand-text"
                      : "border-line text-ink-2 hover:bg-surface-2"
                  }`}
                >
                  <ThemeIcon name={t} />
                  {THEME_LABELS[t]}
                </button>
              ))}
            </div>
            {theme === "system" && (
              <p className="text-xs text-ink-3 mt-2">Follows your device and changes with it.</p>
            )}

            <p className="text-sm font-medium text-ink-2 mt-4 mb-2">Accent colour</p>
            <div role="radiogroup" aria-label="Accent colour" className="flex gap-3">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={accent === a}
                  aria-label={a}
                  title={a}
                  onClick={() => chooseAccent(a)}
                  style={{ backgroundColor: ACCENT_SWATCH[a] }}
                  className={`w-8 h-8 rounded-full flex items-center justify-center ring-offset-2 ring-offset-surface ${
                    accent === a ? "ring-2 ring-ink-3" : ""
                  }`}
                >
                  {accent === a && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Notifications */}
          <section aria-labelledby="notify-title">
            <h3 id="notify-title" className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">
              Notifications
            </h3>
            <div className="border border-line rounded-xl overflow-hidden divide-y divide-line">
              <Switch
                label="Message sounds"
                hint="A short sound for new messages. Muted chats stay silent."
                checked={sound}
                onChange={toggleSound}
              />
              <Switch
                label="Desktop notifications"
                hint="Show a pop-up when PalsChat is in the background."
                checked={desktop}
                onChange={toggleDesktop}
              />
            </div>
            {desktopNote && <p className="text-xs text-danger-text mt-2">{desktopNote}</p>}
          </section>

          {/* Account */}
          <section aria-labelledby="account-title">
            <h3 id="account-title" className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">
              Account
            </h3>
            <div className="border border-line rounded-xl overflow-hidden divide-y divide-line">
              <button type="button" className={`${row} text-ink`} onClick={onOpenProfile}>
                <span className="flex items-center gap-3">
                  <UserAvatar user={user} size="sm" showStatus={false} />
                  <span>
                    <span className="block font-medium">{user?.name}</span>
                    <span className="block text-xs text-ink-3">Edit picture, name and about</span>
                  </span>
                </span>
                <span className="text-ink-4" aria-hidden="true">›</span>
              </button>
              <button type="button" className={`${row} text-ink`} onClick={onOpenSecurity}>
                <span>Password and devices</span>
                <span className="text-ink-4" aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className={`${row} text-danger-text hover:bg-danger-soft`}
                onClick={onLogout}
              >
                <span>Sign out</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
