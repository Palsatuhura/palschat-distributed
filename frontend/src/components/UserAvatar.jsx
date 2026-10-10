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

// Generates a consistent color based on the user's name
const getAvatarColor = (name = "") => {
  const colors = [
    "bg-blue-500", "bg-purple-500", "bg-green-500", "bg-yellow-500",
    "bg-red-500", "bg-pink-500", "bg-indigo-500", "bg-teal-500",
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
        <div
          className={`${sz} ${getAvatarColor(user?.name)} rounded-full flex items-center justify-center font-semibold text-white`}
        >
          {getInitials(user?.name)}
        </div>
      )}

      {/* Online status dot */}
      {showStatus && (
        <span
          className={`absolute ${dotSz} rounded-full border-2 border-white 
            ${isOnline ? "bg-green-500" : "bg-gray-400"}`}
        />
      )}
    </div>
  );
};

export default UserAvatar;
