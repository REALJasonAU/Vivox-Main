import type { Config } from "tailwindcss";



const config: Config = {

  darkMode: "class",

  content: [

    "./src/app/**/*.{ts,tsx}",

    "./src/components/**/*.{ts,tsx}",

    "./src/hooks/**/*.{ts,tsx}",

    "./src/lib/**/*.{ts,tsx}",

  ],

  theme: {

    extend: {

      colors: {

        background: "rgb(var(--background) / <alpha-value>)",

        surface: "rgb(var(--surface) / <alpha-value>)",

        "surface-raised": "rgb(var(--surface-raised) / <alpha-value>)",

        foreground: "rgb(var(--foreground) / <alpha-value>)",

        muted: "rgb(var(--muted) / <alpha-value>)",

        subtle: "rgb(var(--subtle) / <alpha-value>)",

        border: "rgb(var(--border) / <alpha-value>)",

        "border-focus": "rgb(var(--border-focus-rgb) / <alpha-value>)",

        accent: "rgb(var(--accent) / <alpha-value>)",

        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",

        zinc: {

          950: "#09090b",

          900: "#18181b",

          800: "#27272a",

          700: "#3f3f46",

          500: "#71717a",

          400: "#a1a1aa",

          100: "#f4f4f5",

        },

        vivox: {
          50: "#fff0f0",
          100: "#ffe0e0",
          200: "#ffc0c0",
          300: "#ff9595",
          400: "#ff5555",
          500: "#e5181b",
          600: "#c01015",
          700: "#9a0e12",
          800: "#7e1013",
          900: "#6b1113",
          950: "#420b0c",
        },

        emerald: {

          500: "#10b981",

        },

        amber: {

          500: "#f59e0b",

        },

        // status palette

        provisioning: "rgb(var(--status-provisioning) / <alpha-value>)",

        starting: "rgb(var(--status-starting) / <alpha-value>)",

        running: "rgb(var(--status-running) / <alpha-value>)",

        stopping: "rgb(var(--status-stopping) / <alpha-value>)",

        stopped: "rgb(var(--status-stopped) / <alpha-value>)",

        crashed: "rgb(var(--status-crashed) / <alpha-value>)",

      },

      fontFamily: {

        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],

        mono: ["var(--font-mono)", "ui-monospace", "monospace"],

      },

      borderRadius: {

        lg: "0.5rem",

        xl: "0.75rem",

        "2xl": "1rem",

        "3xl": "1.5rem",

      },

      backdropBlur: {

        md: "12px",

      },

      keyframes: {

        "fade-in": {

          from: { opacity: "0", transform: "translateY(6px)" },

          to: { opacity: "1", transform: "translateY(0)" },

        },

        "status-pulse": {

          "0%, 100%": { opacity: "1", transform: "scale(1)" },

          "50%": { opacity: "0.45", transform: "scale(0.85)" },

        },

        shimmer: {

          "100%": { transform: "translateX(100%)" },

        },

      },

      animation: {

        "fade-in": "fade-in 0.3s ease-out",

        "status-pulse": "status-pulse 1.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",

        shimmer: "shimmer 1.8s infinite",

      },

    },

  },

  plugins: [],

};



export default config;


