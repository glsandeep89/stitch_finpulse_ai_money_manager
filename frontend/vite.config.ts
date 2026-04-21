import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["finpulse-icon.svg"],
      manifest: {
        name: "FinPulse",
        short_name: "FinPulse",
        description: "Personal finance overview and budgets",
        theme_color: "#f8f9ff",
        background_color: "#f8f9ff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/finpulse-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2}"],
      },
    }),
  ],
  server: { port: 5173 },
});
