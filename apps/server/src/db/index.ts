/**
 * Thin DB adapter: real PostgreSQL in production (DATABASE_URL), embedded
 * PGlite (the Postgres engine compiled to WASM) for local dev and tests.
 * Both run the same SQL and the same constraints.
 */
import { MIGRATIONS } from "./schema.ts";

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Tx {
  tx<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
  close(): Promise<void>;
  kind: "postgres" | "pglite";
}

export async function openDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  const db = opts.url ? await openPg(opts.url) : await openPglite(opts.dataDir);
  await migrate(db);
  return db;
}

async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  // PGlite is single-connection: serialize transactions with a promise chain.
  let chain: Promise<unknown> = Promise.resolve();
  const q: Tx["query"] = async (sql, params) => {
    const r = await pg.query(sql, params as never[]);
    return { rows: r.rows as never[] };
  };
  return {
    kind: "pglite",
    query: (sql, params) => { const p = chain.then(() => q(sql, params)); chain = p.catch(() => {}); return p as never; },
    tx: <R>(fn: (tx: Tx) => Promise<R>) => {
      const p = chain.then(() =>
        pg.transaction(async (t) => fn({ query: async (sql, params) => ({ rows: (await t.query(sql, params as never[])).rows as never[] }) })),
      );
      chain = p.catch(() => {});
      return p as Promise<R>;
    },
    close: () => pg.close(),
  };
}

async function openPg(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    kind: "postgres",
    query: async (sql, params) => ({ rows: (await pool.query(sql, params as unknown[])).rows }),
    tx: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        const r = await fn({ query: async (sql, params) => ({ rows: (await c.query(sql, params as unknown[])).rows }) });
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

async function migrate(db: Db) {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (id INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const done = new Set((await db.query<{ id: number }>("SELECT id FROM schema_migrations")).rows.map((r) => Number(r.id)));
  for (const [i, sql] of MIGRATIONS.entries()) {
    const id = i + 1;
    if (done.has(id)) continue;
    await db.tx(async (tx) => {
      for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await tx.query(stmt);
      await tx.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
    });
  }
}
