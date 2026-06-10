import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true so the demo can be opened from a real phone on the same network
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
});
