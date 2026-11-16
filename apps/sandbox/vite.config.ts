import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.SANDBOX_UI_PORT || 4404),
    strictPort: true,
    proxy: {
      "/api": process.env.SANDBOX_API_ORIGIN || "http://127.0.0.1:4415",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
  base: process.env.SATS_BUILD_BASE || "/",
});
