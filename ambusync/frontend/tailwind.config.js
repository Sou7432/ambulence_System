/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["system-ui", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        clinical: {
          50: "#f0fdf9",
          100: "#ccfbf1",
          500: "#0d9488",
          700: "#0f766e",
          900: "#134e4a",
        },
        alert: "#dc2626",
      },
    },
  },
  plugins: [],
};
