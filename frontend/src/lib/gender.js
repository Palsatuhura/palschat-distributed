/** The choices offered at signup and in the profile. */
export const GENDER_CHOICES = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "unspecified", label: "Prefer not to say" },
];

export const isGender = (v) => GENDER_CHOICES.some((c) => c.value === v);

/** Anything unexpected (old accounts, missing field) counts as unspecified. */
export const genderOf = (user) => (isGender(user?.gender) ? user.gender : "unspecified");

/**
 * Which default picture to draw when someone has not uploaded one.
 * Deleted users always get the neutral icon.
 */
export const defaultAvatarKind = (user) => (user?.deletedAt ? "unspecified" : genderOf(user));
