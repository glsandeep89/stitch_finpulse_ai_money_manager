import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * PWA precache previously included all JS/CSS/HTML. That let a stale service worker serve
 * an old bundle (e.g. API URL still localhost) after env fixes — "Failed to fetch" forever.
 * Precache only static icons/manifest; app JS always loads from the network.
 */
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const viteApiUrl = (process.env.VITE_API_URL || fileEnv.VITE_API_URL || "").replace(/\/+$/, "");
  const apiBaseJson = JSON.stringify(viteApiUrl);

  return {
    plugins: [
      react(),
      {
        name: "inject-finpulse-api-base",
        transformIndexHtml(html) {
          if (!viteApiUrl) return html;
          return html.replace(
            "<head>",
            `<head>\n    <script>window.__FINPULSE_API_BASE__=${apiBaseJson};</script>`
          );
        },
      },
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
          globPatterns: ["**/*.{svg,ico}", "**/manifest.webmanifest"],
        },
      }),
    ],
    server: { port: 5173 },
  };
});
