import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/__snapshots": "http://127.0.0.1:3001",
      "/_next": "http://127.0.0.1:3001",
      "/assets": "http://127.0.0.1:3001",
      "/audio": "http://127.0.0.1:3001",
      "/icon.svg": "http://127.0.0.1:3001",
      "/manifest.json": "http://127.0.0.1:3001",
      "/manifest.webmanifest": "http://127.0.0.1:3001",
      "/og-landing.png": "http://127.0.0.1:3001"
    }
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    reactRouter()
  ]
});
