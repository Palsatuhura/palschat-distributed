/**
 * GroupAvatar
 * A group's picture, or a default group icon when it has none.
 *   size: "md" (40px) | "xl" (96px)
 */
const SIZES = {
  md: { box: "w-10 h-10", icon: "w-5 h-5" },
  xl: { box: "w-24 h-24", icon: "w-12 h-12" },
};

const GroupAvatar = ({ avatar, size = "md" }) => {
  const s = SIZES[size] || SIZES.md;

  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        className={`${s.box} rounded-full object-cover flex-shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${s.box} bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center flex-shrink-0`}
    >
      <svg className={`${s.icon} text-white`} fill="currentColor" viewBox="0 0 20 20">
        <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
      </svg>
    </div>
  );
};

export default GroupAvatar;
