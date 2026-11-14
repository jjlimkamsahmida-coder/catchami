import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.CATCHAMI_API ?? "http://127.0.0.1:8797";

// Local HTTPS (needed for phone cameras on the LAN): create with
//   mkcert -cert-file data/certs/dev.pem -key-file data/certs/dev-key.pem localhost 127.0.0.1 <your-lan-ip>
const certDir = resolve(import.meta.dirname, "../../data/certs");
// NEAR Auth's shared testnet login only allows http://localhost:3000, so `pnpm dev:nearauth` serves plain HTTP there.
const nearAuthMode = process.env.CATCHAMI_NEAR_AUTH_DEV === "1";
const https = !nearAuthMode && existsSync(resolve(certDir, "dev.pem"))
  ? { cert: readFileSync(resolve(certDir, "dev.pem")), key: readFileSync(resolve(certDir, "dev-key.pem")) }
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    port: nearAuthMode ? 3000 : 5173,
    strictPort: nearAuthMode,
    host: nearAuthMode ? "localhost" : true,
    https,
    // CATCHAMI_API can point at a remote server (e.g. the live testnet one): changeOrigin sends its own Host.
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/media": { target: api, changeOrigin: true },
      "/models": { target: api, changeOrigin: true },
      "/ws": { target: api.replace(/^http/, "ws"), ws: true, changeOrigin: true },
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
});
