import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

function usesHostedPostgres(connectionString: string): boolean {
  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    return hostname.includes("supabase.co") || hostname.includes("pooler.supabase.com");
  } catch {
    return false;
  }
}

const connectionString = process.env.DATABASE_URL;
const hasExplicitSslMode = /([?&])sslmode=/i.test(connectionString);
const ssl = hasExplicitSslMode || !usesHostedPostgres(connectionString)
  ? undefined
  : { rejectUnauthorized: true };

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
