import { rootCertificates } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";

type PoolOptions = {
  connectionString: string;
  ssl?: { ca?: string; rejectUnauthorized?: boolean };
};

const poolQuery = vi.hoisted(() => vi.fn());
const PoolMock = vi.hoisted(() => vi.fn(function PoolMock(_options: PoolOptions) {
  return { query: poolQuery };
}));

vi.mock("pg", () => ({ Pool: PoolMock }));

describe("database connection TLS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    PoolMock.mockClear();
    poolQuery.mockReset();
  });

  it("uses the supplied verified Supabase CA and strips URL SSL parameters", async () => {
    const ca = rootCertificates[0];
    if (!ca) throw new Error("Node has no trusted root certificates available for this test");

    vi.stubEnv("DATABASE_URL", "postgres://db-user:p%40ss@db.example.supabase.co:6543/freclean?sslmode=disable&sslrootcert=%2Ftmp%2Fca.pem&application_name=freclean");
    vi.stubEnv("SUPABASE_CA_CERT", ca);

    await import("./db.js");

    const options = PoolMock.mock.calls[0]?.[0];
    if (!options) throw new Error("PostgreSQL pool was not configured");
    expect(options.connectionString).toBe("postgres://db-user:p%40ss@db.example.supabase.co:6543/freclean?application_name=freclean");
    expect(options.ssl).toEqual({ ca, rejectUnauthorized: true });
  });

  it("fails clearly when a Supabase URL has no CA certificate", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:password@db.example.supabase.co/freclean");

    await expect(import("./db.js")).rejects.toThrow("SUPABASE_CA_CERT is required");
    expect(PoolMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid Supabase CA certificate", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:password@db.example.supabase.co/freclean");
    vi.stubEnv("SUPABASE_CA_CERT", "not a PEM certificate");

    await expect(import("./db.js")).rejects.toThrow("valid PEM-encoded CA certificate");
    expect(PoolMock).not.toHaveBeenCalled();
  });

  it("rejects PostgreSQL connection failures without hiding them as success", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:password@localhost:5432/freclean");
    poolQuery.mockRejectedValue(new Error("connection refused"));

    const { query } = await import("./db.js");

    await expect(query("SELECT 1")).rejects.toThrow("connection refused");
  });

  it("uses verified TLS for Render external PostgreSQL URLs", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:password@dpg-test-a.oregon-postgres.render.com/freclean");

    await import("./db.js");

    expect(PoolMock).toHaveBeenCalledWith(expect.objectContaining({
      ssl: { rejectUnauthorized: true },
    }));
  });

  it("does not enable TLS for Render internal URLs", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:password@dpg-test-a/freclean");

    await import("./db.js");

    expect(PoolMock).toHaveBeenCalledWith(expect.not.objectContaining({ ssl: expect.anything() }));
  });
});
