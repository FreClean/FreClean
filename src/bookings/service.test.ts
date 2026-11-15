import { beforeEach, describe, expect, it, vi } from "vitest";

const poolConnect = vi.hoisted(() => vi.fn());
const clientQuery = vi.hoisted(() => vi.fn());
const clientRelease = vi.hoisted(() => vi.fn());
const dbQuery = vi.hoisted(() => vi.fn());

vi.mock("../db.js", () => ({
  pool: { connect: poolConnect },
  query: dbQuery,
}));

import { requestBooking } from "./service.js";

const input = {
  customerId: "00000000-0000-4000-8000-000000000001",
  serviceId: "00000000-0000-4000-8000-000000000002",
  businessLocationId: "00000000-0000-4000-8000-000000000003",
  addressId: "00000000-0000-4000-8000-000000000004",
  scheduledStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  scheduledEnd: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
};

function prepareBooking() {
  poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease });
  clientQuery
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [{ id: input.addressId }] })
    .mockResolvedValueOnce({ rows: [{ id: input.businessLocationId }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ price_cents: 5000, currency: "USD" }] })
    .mockResolvedValueOnce({ rows: [{ id: "booking-id", price_cents: 5000 }] })
    .mockResolvedValueOnce({});
}

beforeEach(() => {
  poolConnect.mockReset();
  clientQuery.mockReset();
  clientRelease.mockReset();
  dbQuery.mockReset();
});

describe("customer booking creation", () => {
  it("uses only the authenticated customer's address and active service location", async () => {
    prepareBooking();

    await expect(requestBooking(input)).resolves.toMatchObject({ id: "booking-id" });

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM addresses WHERE id = $1 AND user_id = $2"),
      [input.addressId, input.customerId]
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM business_locations WHERE id = $1 AND active = true"),
      [input.businessLocationId]
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("JOIN services s ON s.id = sp.service_id"),
      [input.serviceId]
    );
    expect(clientRelease).toHaveBeenCalledOnce();
  });

  it("rejects an address that does not belong to the authenticated customer", async () => {
    poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease });
    clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] });

    await expect(requestBooking(input)).rejects.toMatchObject({ status: 404 });
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO bookings"), expect.anything());
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("rejects past or reversed booking times before database access", async () => {
    await expect(requestBooking({
      ...input,
      scheduledStart: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })).rejects.toMatchObject({ status: 400 });
    await expect(requestBooking({
      ...input,
      scheduledEnd: input.scheduledStart,
    })).rejects.toMatchObject({ status: 400 });
    expect(poolConnect).not.toHaveBeenCalled();
  });
});
