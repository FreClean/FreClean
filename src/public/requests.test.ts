import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../db.js", () => ({
  pool: { query: vi.fn(), connect: vi.fn(), end: vi.fn() },
  query: vi.fn(),
}));

const createPublicEnquiry = vi.fn();
vi.mock("./service.js", () => ({ createPublicEnquiry }));

let app: import("express").Express;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.CORS_ORIGIN = "https://freclean.com";
  ({ app } = await import("../server.js"));
});

beforeEach(() => {
  createPublicEnquiry.mockReset();
  createPublicEnquiry.mockResolvedValue("9f1d3f6f-7ab8-44aa-b23f-0a8d0e0c9ad1");
});

const validBody = {
  type: "SERVICE",
  fullName: "Jean Pierre",
  email: "Jean@Example.com",
  phone: "+509 1234-5678",
  service: "Residential cleaning",
  message: "I would like a cleaning estimate for my home.",
};

describe("POST /api/public/requests", () => {
  it("accepts an anonymous enquiry and confirms only after persistence", async () => {
    const response = await request(app).post("/api/public/requests").send(validBody);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      received: true,
      requestId: "9f1d3f6f-7ab8-44aa-b23f-0a8d0e0c9ad1",
    });
  });

  it("rejects missing required fields and invalid email/phone values", async () => {
    const missing = await request(app).post("/api/public/requests").send({ type: "CONTACT" });
    expect(missing.status).toBe(400);

    const invalid = await request(app).post("/api/public/requests").send({
      ...validBody,
      email: "not-an-email",
      phone: "abc123",
    });
    expect(invalid.status).toBe(400);
    expect(createPublicEnquiry).not.toHaveBeenCalled();
  });

  it("rejects oversized requests", async () => {
    const response = await request(app).post("/api/public/requests").send({
      ...validBody,
      message: "x".repeat(20 * 1024),
    });
    expect(response.status).toBe(413);
  });

  it("does not confirm a received request when persistence fails", async () => {
    createPublicEnquiry.mockRejectedValue(new Error("database unavailable"));
    const response = await request(app).post("/api/public/requests").send(validBody);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal server error" });
    expect(response.body.received).toBeUndefined();
  });

  it("applies production CORS behavior to allowed and disallowed origins", async () => {
    const allowed = await request(app)
      .post("/api/public/requests")
      .set("Origin", "https://freclean.com")
      .send(validBody);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://freclean.com");

    const blocked = await request(app)
      .post("/api/public/requests")
      .set("Origin", "https://evil.example")
      .send(validBody);
    expect(blocked.status).toBe(403);
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rate limits excessive public submissions", async () => {
    let limitedStatus = 0;
    for (let index = 0; index < 20 && limitedStatus === 0; index += 1) {
      const response = await request(app).post("/api/public/requests").send({
        ...validBody,
        email: `visitor${index}@example.com`,
      });
      if (response.status === 429) limitedStatus = response.status;
    }
    expect(limitedStatus).toBe(429);
  });
});
