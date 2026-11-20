/** @type {import('tailwindcss').Config} */

// Colours are CSS variables (see src/index.css) so one class works in light
// and dark mode and with any accent colour. `<alpha-value>` keeps classes
// like bg-brand/50 working.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        canvas: v("canvas"),
        surface: { DEFAULT: v("surface"), 2: v("surface-2"), 3: v("surface-3"), 4: v("surface-4") },
        line: { DEFAULT: v("line"), strong: v("line-strong") },
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3"), 4: v("ink-4") },
        brand: { DEFAULT: v("brand"), hover: v("brand-hover"), soft: v("brand-soft"), text: v("brand-text") },
        danger: { DEFAULT: v("danger"), hover: v("danger-hover"), soft: v("danger-soft"), line: v("danger-line"), text: v("danger-text") },
        success: { DEFAULT: v("success"), soft: v("success-soft"), line: v("success-line"), text: v("success-text") },
        warn: { soft: v("warn-soft"), line: v("warn-line"), text: v("warn-text") },
      },
      boxShadow: {
        soft: "0 1px 2px rgb(var(--shadow) / 0.06), 0 4px 16px rgb(var(--shadow) / 0.06)",
        pop: "0 8px 30px rgb(var(--shadow) / 0.18)",
      },
    },
  },
  plugins: [],
};
