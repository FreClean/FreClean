import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const poolQuery = vi.hoisted(() => vi.fn());

vi.mock("./db.js", () => ({
  pool: { query: poolQuery, connect: vi.fn(), end: vi.fn() },
  query: vi.fn(),
}));

let app: import("express").Express;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.CORS_ORIGIN = "https://freclean.com";
  ({ app } = await import("./server.js"));
});

beforeEach(() => {
  poolQuery.mockReset();
});

describe("health endpoints", () => {
  it("returns a minimal 200 response from the root endpoint", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns 200 from the liveness endpoint", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns 200 when PostgreSQL is reachable", async () => {
    poolQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });

    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "ok" });
    expect(poolQuery).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns 503 without credential or database details when PostgreSQL is unavailable", async () => {
    poolQuery.mockRejectedValue(new Error("postgres://user:secret@internal-host/database"));

    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "unavailable", database: "unavailable" });
  });
});
