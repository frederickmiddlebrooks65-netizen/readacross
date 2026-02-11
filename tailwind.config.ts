import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
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
        // Monotone Design System
        base: {
          bg: "hsl(var(--bg))",
          fg: "hsl(var(--fg))",
          muted: "hsl(var(--muted))",
          border: "hsl(var(--border))",
        },
        brand: {
          DEFAULT: "hsl(var(--brand))",
          hover: "hsl(var(--brand-hover))",
          active: "hsl(var(--brand-active))",
          subtle: "hsl(var(--brand-subtle))",
          outline: "hsl(var(--brand-outline))",
          soft: "hsl(var(--brand-soft))",
          text: "hsl(var(--brand-text))",
          underline: "hsl(var(--brand-underline))",
          dot: "hsl(var(--brand-dot))",
          ink: "#1F2933",      /* Ink Black - Primary Text */
          paper: "#F8F9FA",    /* Cool white background */
          surface: "#FFFFFF",
        },
        /* Cool Forest × Mineral Ink Design System */
        forest: {
          DEFAULT: "hsl(var(--forest))",
          hover: "hsl(var(--forest-hover))",
          active: "hsl(var(--forest-active))",
        },
        sage: {
          DEFAULT: "hsl(var(--sage))",
          hover: "hsl(var(--sage-hover))",
          subtle: "hsl(var(--sage-subtle))",
          soft: "hsl(var(--sage-soft))",
        },
        mist: {
          DEFAULT: "hsl(var(--mist))",
          subtle: "hsl(var(--mist-subtle))",
          ring: "hsl(var(--mist-ring))",
        },
        ink: {
          DEFAULT: "#1F2933",
          muted: "#6B7280",
        },
        dot: {
          marker: "hsl(var(--dot-marker))",
          subtle: "hsl(var(--dot-marker-subtle))",
        },
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      fontFamily: {
        serif: ["Libre Baskerville", "Georgia", "serif"],
        sans: ["Pretendard Variable", "Pretendard", "Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
