/**
 * UserAvatar
 * Displays a user's avatar image or falls back to colored initials.
 * Shows an online/offline status dot when showStatus is true.
 *
 * Props:
 *   - user: User object with name, avatar, _id
 *   - isOnline: boolean for the green dot indicator
 *   - size: "sm" | "md" | "lg" (default "md")
 *   - showStatus: boolean (default true)
 */

import { defaultAvatarKind } from "../lib/gender";

// Plain person pictures used until someone uploads their own.
// They fill their box, so wrap them in a round container.
export const DefaultAvatarIcon = ({ gender = "unspecified" }) => {
  const palette = {
    male: ["#dbeafe", "#3b82f6"],
    female: ["#fce7f3", "#ec4899"],
    unspecified: ["#e5e7eb", "#6b7280"],
  }[gender] || ["#e5e7eb", "#6b7280"];
  const [bg, fg] = palette;
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full" role="img" aria-label={`${gender} profile picture`}>
      <rect width="40" height="40" fill={bg} />
      {gender === "female" ? (
        <>
          {/* long hair behind the head and shoulders */}
          <path d="M11 22c0-8 3-13 9-13s9 5 9 13v6H11z" fill={fg} opacity="0.55" />
          <circle cx="20" cy="16" r="6" fill={fg} />
          <path d="M7 40c0-8 5-12 13-12s13 4 13 12z" fill={fg} />
        </>
      ) : (
        <>
          <circle cx="20" cy="15" r="6.5" fill={fg} />
          <path d="M6 40c0-9 6-14 14-14s14 5 14 14z" fill={fg} />
        </>
      )}
    </svg>
  );
};

// Generates a consistent color based on the user's name
const getAvatarColor = (name = "") => {
  const colors = [
    "bg-brand", "bg-purple-500", "bg-success", "bg-yellow-500",
    "bg-danger", "bg-pink-500", "bg-indigo-500", "bg-teal-500",
    "bg-orange-500", "bg-cyan-500",
  ];
  const index = name.charCodeAt(0) % colors.length;
  return colors[index];
};

// Gets initials from a name (e.g., "John Doe" → "JD")
const getInitials = (name = "") => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
};

const sizeClasses = {
  sm: { avatar: "w-8 h-8 text-xs", dot: "w-2.5 h-2.5 bottom-0 right-0" },
  md: { avatar: "w-10 h-10 text-sm", dot: "w-3 h-3 bottom-0 right-0" },
  lg: { avatar: "w-12 h-12 text-base", dot: "w-3.5 h-3.5 bottom-0.5 right-0.5" },
  xl: { avatar: "w-24 h-24 text-2xl", dot: "w-4 h-4 bottom-1 right-1" },
};

const UserAvatar = ({ user, isOnline = false, size = "md", showStatus = true }) => {
  const { avatar: sz, dot: dotSz } = sizeClasses[size] || sizeClasses.md;

  return (
    <div className="relative inline-block flex-shrink-0">
      {user?.avatar ? (
        <img
          src={user.avatar}
          alt={user?.name || "User"}
          className={`${sz} rounded-full object-cover`}
        />
      ) : (
        <div className={`${sz} rounded-full overflow-hidden flex`}>
          <DefaultAvatarIcon gender={defaultAvatarKind(user)} />
        </div>
      )}

      {/* Online status dot */}
      {showStatus && (
        <span
          className={`absolute ${dotSz} rounded-full border-2 border-surface 
            ${isOnline ? "bg-success" : "bg-ink-4"}`}
        />
      )}
    </div>
  );
};

export default UserAvatar;
