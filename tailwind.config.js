/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Civic-ink palette (design.md §2)
        ink: {
          base: "#0B1220",
          surface: "#101A2E",
          elevated: "#16233C",
          inset: "#080E1A",
          subtle: "#1E2C47",
          strong: "#2C3F63",
          primary: "#E6ECF5",
          secondary: "#9AA8BF",
          muted: "#5E6D87",
        },
        civic: {
          DEFAULT: "#3FAE9E",
          strong: "#63C7B8",
          periwinkle: "#6C8BD4",
          gold: "#C9A24B",
        },
        gold: "#C9A24B",
        status: {
          success: "#4FAE8C",
          warning: "#D9A441",
          danger: "#D9635F",
          info: "#5E93CF",
        },
        confidence: {
          high: "#4FAE8C",
          med: "#D9A441",
          low: "#D9635F",
        },
        chart: {
          1: "#3FAE9E",
          2: "#6C8BD4",
          3: "#C9A24B",
          4: "#8B7BC7",
          5: "#5E93CF",
          6: "#7FAE6E",
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"IBM Plex Serif"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        overlay: "0 8px 32px rgba(2,6,16,0.5)",
        "glow-teal": "0 0 12px rgba(63,174,158,0.25)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        "pulse-dot": {
          "0%,100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        "topo-drift": {
          "0%": { transform: "translate(0, 0)" },
          "100%": { transform: "translate(-2%, -2%)" },
        },
        "hotspot-pulse": {
          "0%,100%": { opacity: "0.9", transform: "scale(1)" },
          "50%": { opacity: "0.35", transform: "scale(1.6)" },
        },
        "pulse-glow": {
          "0%,100%": { boxShadow: "0 0 0px rgba(63,174,158,0)" },
          "50%": { boxShadow: "0 0 12px rgba(63,174,158,0.25)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
        "pulse-dot": "pulse-dot 1.8s ease-in-out infinite",
        "topo-drift": "topo-drift 20s linear infinite alternate",
        "hotspot-pulse": "hotspot-pulse 2.4s ease-in-out infinite",
        "pulse-glow": "pulse-glow 2.8s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
