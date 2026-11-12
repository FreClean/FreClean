import { Pool } from "pg";
import { getPostgresConnectionConfig } from "./postgres-connection.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const { connectionString, ssl } = getPostgresConnectionConfig(
  process.env.DATABASE_URL,
  process.env.SUPABASE_CA_CERT,
);

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000,
  ...(ssl ? { ssl } : {}),
});

export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
