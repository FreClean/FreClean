import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

const poolQuery = vi.hoisted(() => vi.fn());
const createPublicEnquiry = vi.hoisted(() => vi.fn());

vi.mock("./db.js", () => ({
  pool: { query: poolQuery, connect: vi.fn(), end: vi.fn() },
  query: vi.fn(),
}));
vi.mock("./public/service.js", () => ({ createPublicEnquiry }));

let app: import("express").Express;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.CORS_ORIGIN = "https://freclean.com";
  process.env.JWT_ACCESS_SECRET = "integration-test-access-secret-that-is-long";
  delete process.env.CARD_PAYMENTS_ENABLED;
  ({ app } = await import("./server.js"));
});

beforeEach(() => {
  poolQuery.mockReset();
  createPublicEnquiry.mockReset();
  delete process.env.CARD_PAYMENTS_ENABLED;
});

describe("critical production API boundaries", () => {
  it("serves liveness and rejects unavailable readiness", async () => {
    poolQuery.mockRejectedValue(new Error("connection details must not be returned"));

    const health = await request(app).get("/health");
    const ready = await request(app).get("/health/ready");

    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: "unavailable", database: "unavailable" });
  });

  it("rejects unauthenticated booking and cash workflows", async () => {
    const booking = await request(app).post("/api/bookings/").send({});
    const cash = await request(app).post("/api/payments/cash").send({});

    expect(booking.status).toBe(401);
    expect(cash.status).toBe(401);
  });

  it("rejects invalid JWTs and accepts correctly signed customer identity", async () => {
    const secret = process.env.JWT_ACCESS_SECRET!;
    const validToken = jwt.sign({ roles: ["CUSTOMER"] }, secret, { subject: "customer-1" });

    const invalid = await request(app)
      .post("/api/bookings/")
      .set("Authorization", "Bearer invalid-token")
      .send({});
    const missing = await request(app)
      .post("/api/bookings/")
      .set("Authorization", `Bearer ${validToken}`)
      .send({});

    expect(invalid.status).toBe(401);
    expect(missing.status).toBe(400);
  });

  it("fails closed for card webhook processing when disabled", async () => {
    const response = await request(app)
      .post("/api/payments/card/webhook")
      .set("X-Webhook-Signature", "00")
      .send({ event: {} });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Card payments are not enabled" });
  });

  it("validates public enquiries, permits the approved CORS origin, and blocks unknown origin", async () => {
    const invalid = await request(app)
      .post("/api/public/requests")
      .set("Origin", "https://freclean.com")
      .send({});
    expect(invalid.status).toBe(400);
    expect(invalid.headers["access-control-allow-origin"]).toBe("https://freclean.com");

    const blocked = await request(app)
      .post("/api/public/requests")
      .set("Origin", "https://evil.example")
      .send({});
    expect(blocked.status).toBe(403);
  });
});
