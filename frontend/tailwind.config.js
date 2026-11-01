/** @type {import('tailwindcss').Config} */
// Every colour is a Yaapu token from src/tokens.css. color-mix keeps opacity modifiers
// (bg-accent/15) working on top of the CSS variables.
const token = (name) => `color-mix(in oklab, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "surface-0": token("color-pearl"),
        "surface-1": token("color-white"),
        "surface-2": token("color-surface-2"),
        "surface-3": token("color-surface-3"),
        line: token("color-line"),
        fg: token("color-ink"),
        "fg-2": token("color-ink-2"),
        muted: token("color-muted"),
        accent: token("color-lime"),
        "accent-soft": token("color-lime-soft"),
        "accent-ink": token("color-ink"),
        social: token("color-gum"),
        "social-ink": token("color-gum-ink"),
        ink: token("color-ink"),
        "ink-soft": token("color-ink-soft"),
        "ink-muted": token("color-ink-muted"),
        sky: token("color-sky"),
        peach: token("color-peach"),
        gold: token("color-warn"),
        danger: token("color-error"),
        scrim: token("color-scrim"),
        ambient: token("ambient"),
      },
      fontFamily: {
        sans: ["var(--font-body)"],
        display: ["var(--font-display)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        sticker: "var(--shadow-sticker)",
        float: "var(--shadow-float)",
        card: "var(--shadow-card)",
        // older names kept so existing classes stay meaningful
        part: "var(--shadow-sticker)",
        panel: "var(--shadow-card)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
      },
      transitionDuration: {
        micro: "120ms",
        short: "220ms",
        bloom: "700ms",
      },
    },
  },
  plugins: [],
};
