import { previewText } from "./attachmentInfo.js";

/**
 * New-message alerts: a short sound and, if the person allows it, a desktop
 * notification. Chats the person muted never alert, and nothing alerts for a
 * chat they are looking at right now. Settings are kept in this browser.
 */

const SOUND_KEY = "palschat.sound";
const DESKTOP_KEY = "palschat.desktop";

const read = (key) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* not remembered */
  }
};

export const isSoundOn = () => read(SOUND_KEY) !== "0"; // on unless switched off
export const setSoundOn = (on) => write(SOUND_KEY, on ? "1" : "0");

export const desktopSupported = () => typeof window !== "undefined" && "Notification" in window;
export const desktopPermission = () => (desktopSupported() ? Notification.permission : "unsupported");
export const isDesktopOn = () => read(DESKTOP_KEY) === "1" && desktopPermission() === "granted";

/**
 * Turn desktop notifications on or off. Turning on asks the browser for
 * permission. Resolves to true when they are on afterwards.
 */
export const setDesktopOn = async (on) => {
  if (!on) {
    write(DESKTOP_KEY, "0");
    return false;
  }
  if (!desktopSupported()) return false;
  const permission =
    Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  const granted = permission === "granted";
  write(DESKTOP_KEY, granted ? "1" : "0");
  return granted;
};

/**
 * Pure rule: what should happen for an incoming message?
 *   fromMe        I sent it (from this or another device)
 *   muted         I muted this chat
 *   viewingChat   this chat is the open one
 *   tabHidden     the tab is in the background or the window is minimised
 */
export const decideNotification = ({ fromMe, muted, viewingChat, tabHidden, soundOn, desktopOn }) => {
  if (fromMe || muted) return { sound: false, desktop: false };
  if (viewingChat && !tabHidden) return { sound: false, desktop: false };
  return { sound: Boolean(soundOn), desktop: Boolean(desktopOn) && Boolean(tabHidden) };
};

let audio = null;

/** Two soft notes made in the browser (no sound file needed). */
export const playPing = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio = audio || new Ctx();
    if (audio.state === "suspended") audio.resume().catch(() => {});
    const now = audio.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.22);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.25);
    });
  } catch {
    /* browsers may block sound until the person has clicked on the page */
  }
};

/** Called for every message that arrives from somebody else. */
export const announceMessage = ({ message, conversation, activeConversationId, groupName }) => {
  const tabHidden = document.visibilityState !== "visible";
  const decision = decideNotification({
    fromMe: false,
    muted: Boolean(conversation?.muted),
    viewingChat: activeConversationId === message.conversation,
    tabHidden,
    soundOn: isSoundOn(),
    desktopOn: isDesktopOn(),
  });

  if (decision.sound) playPing();

  if (decision.desktop) {
    try {
      const sender = message.sender?.name || "New message";
      const isGroup = Boolean(conversation?.isGroup);
      const n = new Notification(isGroup ? groupName || "Group" : sender, {
        body: `${isGroup ? sender + ": " : ""}${previewText(message)}`.slice(0, 120),
        tag: message.conversation, // one notification per chat
        silent: true, // we play our own sound
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
};
