import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: { ink: "#1D1D1F", graytext: "#6e6e73", line: "#E5E5EA", surface: "#F5F5F7", dkbg: "#161618", dksurf: "#1C1C1E", dkcard: "#2C2C2E", dkline: "#3A3A3C", blue: "#3A5CCC" },
      fontFamily: { sans: ["Inter", "Helvetica Neue", "Arial", "sans-serif"] },
      keyframes: { fadeUp: { "0%": { opacity: "0", transform: "translateY(12px)" }, "100%": { opacity: "1", transform: "translateY(0)" } }, float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } } },
      animation: { "fade-up": "fadeUp .55s ease both", float: "float 3.2s ease-in-out infinite" }
    }
  },
  plugins: []
} satisfies Config;
