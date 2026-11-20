import { useState } from "react";
import { getTheme, setTheme } from "../lib/theme";

/**
 * A small button that flips between light and dark. For people who have
 * "System" chosen it starts from what the device shows.
 */
const ThemeToggle = ({ className = "" }) => {
  const [, force] = useState(0);
  const isDarkNow = document.documentElement.classList.contains("dark");

  const flip = () => {
    setTheme(isDarkNow ? "light" : "dark");
    force((n) => n + 1);
  };

  return (
    <button
      type="button"
      onClick={flip}
      title={isDarkNow ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDarkNow ? "Switch to light mode" : "Switch to dark mode"}
      data-theme-choice={getTheme()}
      className={`p-2 rounded-full text-ink-3 hover:bg-surface-3 hover:text-ink-2 ${className}`}
    >
      {isDarkNow ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" strokeWidth={2} />
          <path strokeLinecap="round" strokeWidth={2} d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
        </svg>
      )}
    </button>
  );
};

export default ThemeToggle;
