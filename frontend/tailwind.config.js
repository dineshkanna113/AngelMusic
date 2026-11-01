/** @type {import('tailwindcss').Config} */
// Every colour is a Yaapu token from src/tokens.css. color-mix keeps opacity modifiers
// (bg-accent/15) working on top of the CSS variables.
const token = (name) => `color-mix(in oklab, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "surface-0": token("color-night"),
        "surface-1": token("color-dusk"),
        "surface-2": token("color-dusk-2"),
        "surface-3": token("color-dusk-3"),
        line: token("color-line"),
        fg: token("color-jasmine"),
        "fg-2": token("color-jasmine-2"),
        muted: token("color-mist"),
        accent: token("color-marigold"),
        "accent-soft": token("color-marigold-soft"),
        "accent-ink": token("color-marigold-ink"),
        social: token("color-kingfisher"),
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
        bloom: "700ms",
      },
    },
  },
  plugins: [],
};
