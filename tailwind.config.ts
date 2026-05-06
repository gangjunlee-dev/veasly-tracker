import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/renderer/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/renderer/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/renderer/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        "muted-foreground": "rgb(var(--muted-foreground) / <alpha-value>)"
      }
    }
  },
  plugins: []
};

export default config;
