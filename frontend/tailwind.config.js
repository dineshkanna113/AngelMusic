/** @type {import('tailwindcss').Config} */
// Every colour is a Ribbon token from src/tokens.css. color-mix keeps opacity modifiers
// (bg-accent/15) working on top of oklch values.
const token = (name) => `color-mix(in oklab, var(--color-${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "surface-0": token("paper"),
        "surface-1": token("paper-2"),
        "surface-2": token("paper-3"),
        "surface-3": token("paper-4"),
        line: token("rule"),
        fg: token("ink"),
        "fg-2": token("ink-2"),
        muted: token("muted"),
        accent: token("accent"),
        "accent-soft": token("accent-soft"),
        "accent-ink": token("accent-ink"),
        gold: token("warn"),
        danger: token("error"),
        scrim: token("scrim"),
      },
      fontFamily: {
        sans: ["var(--font-body)"],
        display: ["var(--font-display)"],
      },
      borderRadius: {
        card: "var(--radius-card)",
        part: "var(--radius-part)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        part: "var(--edge-light), var(--shadow-part)",
        panel: "var(--edge-light), var(--shadow-panel)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
      },
      transitionDuration: {
        micro: "120ms",
        short: "220ms",
        long: "420ms",
      },
    },
  },
  plugins: [],
};
