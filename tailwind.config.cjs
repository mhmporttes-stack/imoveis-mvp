/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "./lib/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1F2937",
        muted: "#667085",
        navy: "#0D3B66",
        brand: "#1769D1",
        mist: "#F5F7FA",
        line: "#E5EAF1"
      },
      boxShadow: {
        premium: "0 24px 80px rgba(13, 59, 102, 0.10)",
        soft: "0 14px 40px rgba(13, 59, 102, 0.08)"
      },
      fontFamily: {
        sans: ["Inter", "Manrope", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
