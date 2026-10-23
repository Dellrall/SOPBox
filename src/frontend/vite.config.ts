import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Never inline assets as data: URLs. The CSP only allows fonts and scripts from this site.
  build: { assetsInlineLimit: 0 },
  server: {
    proxy: { "/api": "http://localhost:8000" },
  },
});
