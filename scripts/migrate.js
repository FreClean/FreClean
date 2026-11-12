#!/usr/bin/env node
// Minimal migration runner: applies every .sql file in database/migrations
// in filename order, tracked in a schema_migrations table.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import "dotenv/config";
import { getPostgresConnectionConfig } from "../src/postgres-connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "database", "migrations");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const { connectionString, ssl } = getPostgresConnectionConfig(
    process.env.DATABASE_URL,
    process.env.SUPABASE_CA_CERT,
  );

  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    query_timeout: 5000,
    statement_timeout: 5000,
    ...(ssl ? { ssl } : {}),
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);

  const applied = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`Applying ${file}...`);
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  }
  await pool.end();
  console.log("Migrations up to date.");
}

main().catch((err) => {
  if (err?.code === "SUPABASE_CA_CERT_REQUIRED" || err?.code === "SUPABASE_CA_CERT_INVALID") {
    console.error(err.message);
  } else {
    const code = typeof err?.code === "string" ? ` (${err.code})` : "";
    console.error(`Migration failed${code}.`);
  }
  process.exit(1);
});
