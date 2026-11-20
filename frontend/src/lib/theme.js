/**
 * Theme: light, dark or follow the device ("system"), plus an accent colour.
 * The choice is remembered in this browser only (localStorage), and applied
 * by putting a class and an attribute on <html> (see index.css).
 */

export const THEMES = ["light", "dark", "system"];
export const ACCENTS = ["blue", "violet", "emerald", "rose", "amber"];

const THEME_KEY = "palschat.theme";
const ACCENT_KEY = "palschat.accent";

/** Anything unknown becomes the default. */
export const normalizeTheme = (value) => (THEMES.includes(value) ? value : "system");
export const normalizeAccent = (value) => (ACCENTS.includes(value) ? value : "blue");

/** Is dark mode on, given the person's choice and what the device prefers? */
export const isDark = (theme, systemPrefersDark) =>
  theme === "dark" || (normalizeTheme(theme) === "system" && Boolean(systemPrefersDark));

const read = (key) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private window or blocked storage
  }
};

const write = (key, value) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* the choice just will not be remembered */
  }
};

export const getTheme = () => normalizeTheme(read(THEME_KEY));
export const getAccent = () => normalizeAccent(read(ACCENT_KEY));

const systemDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Put the theme on the page right now. */
export const applyTheme = (theme = getTheme(), accent = getAccent()) => {
  const root = document.documentElement;
  const dark = isDark(theme, systemDark());
  root.classList.toggle("dark", dark);
  if (normalizeAccent(accent) === "blue") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", normalizeAccent(accent));

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0f172a" : "#ffffff");
};

export const setTheme = (theme) => {
  const t = normalizeTheme(theme);
  write(THEME_KEY, t);
  applyTheme(t, getAccent());
};

export const setAccent = (accent) => {
  const a = normalizeAccent(accent);
  write(ACCENT_KEY, a);
  applyTheme(getTheme(), a);
};

/**
 * Call once at start-up: applies the saved choice and, while the choice is
 * "system", follows the device when it switches (for example at sunset).
 */
export const initTheme = () => {
  applyTheme();
  if (typeof window.matchMedia !== "function") return;
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getTheme() === "system") applyTheme();
  };
  if (query.addEventListener) query.addEventListener("change", onChange);
};
