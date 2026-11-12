/** Load a local .env (repo root or apps/server) before anything reads process.env. Real secrets stay out of git (.env is ignored). */
for (const f of [".env", "apps/server/.env"]) {
  try { process.loadEnvFile(f); } catch { /* no file — fine */ }
}
