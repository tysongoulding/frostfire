/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['selector', '[data-mode="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Ubuntu', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        ubuntu: ['Ubuntu', 'sans-serif'],
        outfit: ['Outfit', 'sans-serif'],
      },
      colors: {
        theme: {
          bg: 'var(--bg)',
          surface: 'var(--surface)',
          border: 'var(--border)',
          'text-primary': 'var(--text-primary)',
          'text-muted': 'var(--text-muted)',
          'accent-primary': 'var(--accent-primary)',
          'accent-secondary': 'var(--accent-secondary)',
        },
        brand: {
          50: "#f0fdf4",
          100: "#dcfce7",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          900: "#14532d",
        },
        slate: {
          850: "#151e2e",
          925: "#0b0f19",
          950: "#060911",
        }
      }
    },
  },
  plugins: [],
}
