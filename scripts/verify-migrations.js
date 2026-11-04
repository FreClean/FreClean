#!/usr/bin/env node
import pg from "pg";
import "dotenv/config";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "database", "migrations");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const connectionString = process.env.DATABASE_URL;
let hostedPostgres = false;
try {
  const hostname = new URL(connectionString).hostname.toLowerCase();
  hostedPostgres = hostname.includes("supabase.co") || hostname.includes("pooler.supabase.com");
} catch {
  hostedPostgres = false;
}
const hasExplicitSslMode = /([?&])sslmode=/i.test(connectionString);
const pool = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  query_timeout: 5000,
  statement_timeout: 5000,
  ...(hostedPostgres && !hasExplicitSslMode ? { ssl: { rejectUnauthorized: true } } : {}),
});

try {
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const applied = (await pool.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((row) => row.name);
  const pending = files.filter((file) => !applied.includes(file));
  const requiredTables = (await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('public_enquiries','schema_migrations') ORDER BY tablename"
  )).rows.map((row) => row.tablename);
  const enquiryIndexes = (await pool.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'public_enquiries' ORDER BY indexname"
  )).rows.map((row) => row.indexname);
  const requiredEnquiryColumns = [
    "property_type", "space_size", "requested_date", "requested_time",
    "location", "notes", "payment_method",
  ];
  const publicEnquiryColumns = (await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'public_enquiries' ORDER BY column_name"
  )).rows.map((row) => row.column_name);
  const missingEnquiryColumns = requiredEnquiryColumns.filter((column) => !publicEnquiryColumns.includes(column));

  console.log(JSON.stringify({
    applied,
    pending,
    requiredTables,
    publicEnquiryIndexes: enquiryIndexes,
    missingEnquiryColumns,
  }));

  if (pending.length > 0 || requiredTables.length !== 2 || missingEnquiryColumns.length > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
