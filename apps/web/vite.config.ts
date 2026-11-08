import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.CATCHAMI_API ?? "http://127.0.0.1:8797";

// Local HTTPS (needed for phone cameras on the LAN): create with
//   mkcert -cert-file data/certs/dev.pem -key-file data/certs/dev-key.pem localhost 127.0.0.1 <your-lan-ip>
const certDir = resolve(import.meta.dirname, "../../data/certs");
const https = existsSync(resolve(certDir, "dev.pem"))
  ? { cert: readFileSync(resolve(certDir, "dev.pem")), key: readFileSync(resolve(certDir, "dev-key.pem")) }
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    https,
    proxy: {
      "/api": api,
      "/media": api,
      "/models": api,
      "/ws": { target: api.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
});
