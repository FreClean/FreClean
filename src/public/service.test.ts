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
  });

  it("returns the UUID only after the insert commits", async () => {
    query.mockResolvedValue([]);
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: "7cc74c7e-4d65-4ac6-a6f7-9f5c019b6df8" }] })
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
      expect.stringContaining("INSERT INTO public_enquiries"),
      "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and does not return an ID when persistence fails", async () => {
    query.mockResolvedValue([]);
    client.query
      .mockResolvedValueOnce({})
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
});
