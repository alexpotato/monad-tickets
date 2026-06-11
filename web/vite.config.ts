import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// BASE_PATH=/monad-tickets/ is set by the GitHub Pages workflow; local builds
// and dev serve from /. host: true so the demo is reachable from a phone on
// the same network during development.
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Monad Tickets",
        short_name: "Tickets",
        description:
          "On-chain ticketing demo on Monad: buy seats, hold ticket NFTs, check in at the gate.",
        theme_color: "#836ef9",
        background_color: "#0c0e14",
        display: "standalone",
        orientation: "portrait",
        start_url: "./#/attendee",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell + assets cached for offline launch; chain data is always
        // live RPC (never cached — it must reflect the real chain).
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        navigateFallback: undefined,
      },
    }),
  ],
  server: { host: true, port: 5173 },
});
