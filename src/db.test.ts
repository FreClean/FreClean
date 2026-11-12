import { afterEach, describe, expect, it, vi } from "vitest";

const PoolMock = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({ Pool: PoolMock }));

describe("database connection TLS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    PoolMock.mockClear();
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
