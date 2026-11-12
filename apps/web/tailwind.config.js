/** @type {import('tailwindcss').Config} */
export default {
  content: ["apps/web/public/index.html", "apps/web/public/app.js"],
  theme: {
    extend: {
      colors: {
        "ai-bg": "#0b0c10",
        "ai-surface": "#161d25",
        "ai-border": "#23303a",
        "ai-accent": "#4fc3f7",
        "ai-secondary": "#45a29e",
        "ai-muted": "#889097",
        "ai-text": "#c5c6c7",
        "ai-panel": "#11141b",
      },
    },
  },
};
