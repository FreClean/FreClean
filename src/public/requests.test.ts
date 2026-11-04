import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../db.js", () => ({
  pool: { query: vi.fn(), connect: vi.fn(), end: vi.fn() },
  query: vi.fn(),
}));

const createPublicEnquiry = vi.fn();
const listPublicEnquiries = vi.fn();
const updatePublicEnquiryStatus = vi.fn();
const hasRecentPublicEnquiry = vi.fn();
const sendPublicEnquiryEmail = vi.fn();
vi.mock("./service.js", () => ({ createPublicEnquiry, hasRecentPublicEnquiry, listPublicEnquiries, updatePublicEnquiryStatus }));
vi.mock("./email.js", () => ({ sendPublicEnquiryEmail }));

let app: import("express").Express;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.CORS_ORIGIN = "https://freclean.com";
  ({ app } = await import("../server.js"));
});

beforeEach(() => {
  createPublicEnquiry.mockReset();
  listPublicEnquiries.mockReset();
  updatePublicEnquiryStatus.mockReset();
  hasRecentPublicEnquiry.mockReset();
  sendPublicEnquiryEmail.mockReset();
  createPublicEnquiry.mockResolvedValue("9f1d3f6f-7ab8-44aa-b23f-0a8d0e0c9ad1");
  hasRecentPublicEnquiry.mockResolvedValue(false);
  sendPublicEnquiryEmail.mockResolvedValue(undefined);
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

  it("preserves every customer request field submitted by the frontend", async () => {
    const response = await request(app).post("/api/public/requests").send({
      service: "Deep cleaning",
      property_type: "Apartment",
      space_size: "Large",
      date: "2026-12-15",
      time: "14:30",
      name: "Maria Santos",
      phone: "+1 809-555-0100",
      email: "Maria@example.com",
      location: "Santo Domingo",
      notes: "Please include kitchen and balcony cleaning.",
      payment_method: "Cash",
    });

    expect(response.status).toBe(201);
    expect(createPublicEnquiry).toHaveBeenCalledWith(expect.objectContaining({
      fullName: "Maria Santos",
      propertyType: "Apartment",
      spaceSize: "Large",
      date: "2026-12-15",
      time: "14:30",
      location: "Santo Domingo",
      notes: "Please include kitchen and balcony cleaning.",
      paymentMethod: "Cash",
    }));
  });

  it("protects administrative list and status routes", async () => {
    const list = await request(app).get("/api/public/requests");
    const update = await request(app).patch("/api/public/requests/00000000-0000-4000-8000-000000000000/status").send({ status: "CONTACTED" });
    expect(list.status).toBe(401);
    expect(update.status).toBe(401);
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

  it("does not confirm an enquiry when Resend rejects it", async () => {
    sendPublicEnquiryEmail.mockRejectedValue(Object.assign(new Error("provider rejected"), { status: 502 }));

    const response = await request(app).post("/api/public/requests").send(validBody);

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: "provider rejected" });
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
