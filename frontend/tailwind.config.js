import { designTokens } from "./designTokens.js";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ...designTokens,
        page: designTokens.background,
        ink: "#1a1d21",
        muted: "#718096",
      },
      fontFamily: {
        headline: ["Manrope", "sans-serif"],
        body: ["Inter", "sans-serif"],
        label: ["Inter", "sans-serif"],
        inter: ["Inter", "sans-serif"],
        manrope: ["Manrope", "sans-serif"],
      },
      borderRadius: {
        xl: "0.5rem",
        "2xl": "1rem",
        "3xl": "1.25rem",
        stitch: "1.5rem",
      },
      boxShadow: {
        ambient: "0 20px 40px rgba(11, 28, 48, 0.06)",
        card: "0 10px 30px rgba(11, 28, 48, 0.03)",
      },
    },
  },
  plugins: [],
};
