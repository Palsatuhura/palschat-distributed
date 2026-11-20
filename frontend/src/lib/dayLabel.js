/**
 * The little heading between messages of different days: "Today",
 * "Yesterday", a weekday for the last week, or a date. Plain JavaScript (no
 * libraries), so it can be tested.
 */

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** True when both times fall on the same calendar day (local time). */
export const isSameDay = (a, b) => startOfDay(new Date(a)) === startOfDay(new Date(b));

export const dayLabel = (value, now = new Date()) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};
