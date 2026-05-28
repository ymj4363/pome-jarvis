import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    strictPort: false,
    proxy: {
      "/agent-api": {
        target: "http://localhost:3001",
        rewrite: path => path.replace(/^\/agent-api/, ""),
        changeOrigin: true,
      }
    }
  }
});

