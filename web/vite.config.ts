import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // Proxy API calls during `npm run dev` to a running backend — either
    // `wrangler dev` (default: localhost:8787) or your deployed Worker URL.
    // Set VITE_API_PROXY_TARGET to override.
    proxy: {
      "/rest": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
