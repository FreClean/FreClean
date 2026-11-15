import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolConnect = vi.hoisted(() => vi.fn());
const poolQuery = vi.hoisted(() => vi.fn());
const clientQuery = vi.hoisted(() => vi.fn());
const clientRelease = vi.hoisted(() => vi.fn());
const sendPublicEnquiryEmail = vi.hoisted(() => vi.fn());

vi.mock("../db.js", () => ({
  pool: { connect: poolConnect, query: poolQuery },
}));
vi.mock("./email.js", () => ({ sendPublicEnquiryEmail }));

import { deliverPendingEnquiryNotifications } from "./notifications.js";

const payload = {
  type: "CONTACT" as const,
  fullName: "Jean Pierre",
  email: "jean@example.com",
  message: "I would like to contact FreClean about a service.",
  submittedAt: "2026-04-16T12:00:00.000Z",
};

const outboxRow = {
  id: "7cc74c7e-4d65-4ac6-a6f7-9f5c019b6df8",
  recipient_email: "contact@freclean.com",
  payload,
};

beforeEach(() => {
  poolConnect.mockReset();
  poolQuery.mockReset();
  clientQuery.mockReset();
  clientRelease.mockReset();
  sendPublicEnquiryEmail.mockReset();
  poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease });
  clientQuery
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [outboxRow] })
    .mockResolvedValueOnce({});
  poolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("public enquiry notification outbox", () => {
  it("delivers queued enquiries with a stable provider idempotency key", async () => {
    sendPublicEnquiryEmail.mockResolvedValue(undefined);

    await expect(deliverPendingEnquiryNotifications()).resolves.toEqual({ sent: 1, failed: 0 });

    expect(sendPublicEnquiryEmail).toHaveBeenCalledWith(
      payload,
      "contact@freclean.com",
      `public-enquiry-${outboxRow.id}`
    );
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'SENT'"),
      [outboxRow.id]
    );
    expect(clientRelease).toHaveBeenCalledOnce();
  });

  it("retains provider failures for retry without returning success-shaped delivery", async () => {
    sendPublicEnquiryEmail.mockRejectedValue(new Error("Email provider returned HTTP 503"));

    await expect(deliverPendingEnquiryNotifications()).resolves.toEqual({ sent: 0, failed: 1 });

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("next_attempt_at = now() + make_interval"),
      [outboxRow.id, "Email provider returned HTTP 503"]
    );
  });
});
