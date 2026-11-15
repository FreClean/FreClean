#!/usr/bin/env node
import pg from "pg";
import "dotenv/config";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPostgresConnectionConfig } from "../src/postgres-connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "database", "migrations");

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

try {
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const applied = (await pool.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((row) => row.name);
  const pending = files.filter((file) => !applied.includes(file));
  const requiredTables = (await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('payment_notification_outbox','public_enquiries','schema_migrations') ORDER BY tablename"
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
  const requiredPaymentColumns = [
    "customer_id", "asset", "network", "amount", "receiving_address",
    "transaction_hash", "verified_at",
  ];
  const paymentColumns = (await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' ORDER BY column_name"
  )).rows.map((row) => row.column_name);
  const missingPaymentColumns = requiredPaymentColumns.filter((column) => !paymentColumns.includes(column));
  const paymentIndexes = (await pool.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('payments','payment_notification_outbox') ORDER BY indexname"
  )).rows.map((row) => row.indexname);
  const requiredPaymentIndexes = [
    "idx_payments_transaction_hash",
    "idx_payments_customer_created",
    "idx_payments_order",
    "idx_payments_booking",
    "idx_payment_notifications_pending",
  ];
  const missingPaymentIndexes = requiredPaymentIndexes.filter((index) => !paymentIndexes.includes(index));

  console.log(JSON.stringify({
    applied,
    pending,
    requiredTables,
    publicEnquiryIndexes: enquiryIndexes,
    missingEnquiryColumns,
    paymentIndexes,
    missingPaymentColumns,
    missingPaymentIndexes,
  }));

  if (
    pending.length > 0 ||
    requiredTables.length !== 3 ||
    missingEnquiryColumns.length > 0 ||
    missingPaymentColumns.length > 0 ||
    missingPaymentIndexes.length > 0
  ) process.exitCode = 1;
} catch (error) {
  if (error?.code === "SUPABASE_CA_CERT_REQUIRED" || error?.code === "SUPABASE_CA_CERT_INVALID") {
    console.error(error.message);
  } else {
    const code = typeof error?.code === "string" ? ` (${error.code})` : "";
    console.error(`Migration verification failed${code}.`);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
