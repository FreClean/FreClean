import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}));
const pool = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("../db.js", () => ({ query, pool }));

describe("createPublicEnquiry", () => {
  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    client.query.mockReset();
    client.release.mockReset();
    pool.connect.mockReset();
    pool.connect.mockResolvedValue(client);
    process.env.CONTACT_EMAIL = "contact@freclean.com";
  });

  it("stores the enquiry and its contact notification in one transaction", async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: "7cc74c7e-4d65-4ac6-a6f7-9f5c019b6df8",
          created_at: new Date("2026-04-16T12:00:00.000Z"),
        }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const { createPublicEnquiry } = await import("./service.js");

    const id = await createPublicEnquiry({
      type: "SERVICE",
      fullName: "Database Verification",
      email: "verification@example.invalid",
      service: "Audit",
      message: "Explicit persistence verification",
      spamHash: "verification-marker",
      sourceOrigin: "unknown",
    });

    expect(id).toBe("7cc74c7e-4d65-4ac6-a6f7-9f5c019b6df8");
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("SELECT id FROM public_enquiries"),
      expect.stringContaining("INSERT INTO public_enquiries"),
      expect.stringContaining("INSERT INTO public_enquiry_notification_outbox"),
      "COMMIT",
    ]);
    const queuedNotification = JSON.parse(String(client.query.mock.calls[4]?.[1]?.[2]));
    expect(queuedNotification).toMatchObject({
      type: "SERVICE",
      fullName: "Database Verification",
      email: "verification@example.invalid",
      message: "Explicit persistence verification",
      submittedAt: "2026-04-16T12:00:00.000Z",
    });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects a duplicate while holding the transaction-scoped lock", async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: "existing-enquiry" }] })
      .mockResolvedValueOnce({});
    const { createPublicEnquiry } = await import("./service.js");

    await expect(createPublicEnquiry({
      type: "CONTACT",
      fullName: "Database Verification",
      email: "verification@example.invalid",
      message: "Explicit persistence verification",
      spamHash: "verification-marker",
      sourceOrigin: "unknown",
    })).rejects.toMatchObject({ status: 409 });

    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public_enquiries"), expect.anything());
    expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("rolls back and does not return an ID when persistence fails", async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("insert failed"));
    const { createPublicEnquiry } = await import("./service.js");

    await expect(createPublicEnquiry({
      type: "CONTACT",
      fullName: "Database Verification",
      email: "verification@example.invalid",
      message: "Explicit persistence verification",
      spamHash: "verification-marker",
      sourceOrigin: "unknown",
    })).rejects.toThrow("insert failed");

    expect(client.query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back the enquiry when its notification cannot be queued", async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: "7cc74c7e-4d65-4ac6-a6f7-9f5c019b6df8",
          created_at: new Date("2026-04-16T12:00:00.000Z"),
        }],
      })
      .mockRejectedValueOnce(new Error("outbox insert failed"));
    const { createPublicEnquiry } = await import("./service.js");

    await expect(createPublicEnquiry({
      type: "CONTACT",
      fullName: "Database Verification",
      email: "verification@example.invalid",
      message: "Explicit persistence verification",
      spamHash: "verification-marker",
      sourceOrigin: "unknown",
    })).rejects.toThrow("outbox insert failed");

    expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});
