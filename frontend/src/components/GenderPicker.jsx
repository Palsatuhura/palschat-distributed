import { GENDER_CHOICES } from "../lib/gender";
import { DefaultAvatarIcon } from "./UserAvatar";

/**
 * Three big buttons to choose male, female or prefer not to say.
 * The icon on each button is the default picture that choice gives.
 */
const GenderPicker = ({ value, onChange, name = "gender" }) => (
  <div role="radiogroup" aria-label="Gender" className="grid grid-cols-3 gap-2">
    {GENDER_CHOICES.map((c) => {
      const selected = value === c.value;
      return (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={selected}
          name={name}
          onClick={() => onChange(c.value)}
          className={`flex flex-col items-center gap-1.5 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
            selected
              ? "border-brand bg-brand-soft text-brand-text"
              : "border-line-strong text-ink-2 hover:bg-surface-2"
          }`}
        >
          <span className="w-9 h-9 rounded-full overflow-hidden flex">
            <DefaultAvatarIcon gender={c.value} />
          </span>
          {c.label}
        </button>
      );
    })}
  </div>
);

export default GenderPicker;
