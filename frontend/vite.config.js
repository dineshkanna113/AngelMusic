import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  return {
    plugins: [react()],
    server: {
      // Same-origin in dev, matching production where the backend serves the built app.
      proxy: { "/api": { target: env.VITE_PROXY_TARGET || "http://localhost:8000", changeOrigin: true } },
    },
  };
});
