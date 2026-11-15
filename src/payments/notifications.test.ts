import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolConnect = vi.hoisted(() => vi.fn());
const poolQuery = vi.hoisted(() => vi.fn());
const clientQuery = vi.hoisted(() => vi.fn());
const clientRelease = vi.hoisted(() => vi.fn());
const sendPaymentNotification = vi.hoisted(() => vi.fn());

vi.mock("../db.js", () => ({
  pool: { connect: poolConnect, query: poolQuery },
}));
vi.mock("./email.js", () => ({ sendPaymentNotification }));

import { deliverPendingPaymentNotifications } from "./notifications.js";
import { NotificationDeliveryError } from "../notifications/resend.js";

const payload = {
  paymentId: "payment-1",
  customerName: "Test Customer",
  customerEmail: "customer@example.com",
  orderId: "order-1",
  bookingId: null,
  amount: "20.00",
  network: "TRC20" as const,
  transactionHash: "a".repeat(64),
  status: "PAID" as const,
  recipientType: "CUSTOMER" as const,
};

const outboxRow = {
  id: "c7fc33ad-0d8f-4129-9b43-084cd0f2c51d",
  recipient_email: "customer@example.com",
  payload,
};

beforeEach(() => {
  poolConnect.mockReset();
  poolQuery.mockReset();
  clientQuery.mockReset();
  clientRelease.mockReset();
  sendPaymentNotification.mockReset();
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

describe("payment notification outbox", () => {
  it("marks a delivered payment notification as sent", async () => {
    sendPaymentNotification.mockResolvedValue(undefined);

    await expect(deliverPendingPaymentNotifications()).resolves.toEqual({
      sent: 1,
      failed: 0,
      failureCodes: [],
    });

    expect(sendPaymentNotification).toHaveBeenCalledWith(payload, "customer@example.com");
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'SENT'"),
      [outboxRow.id]
    );
    expect(clientQuery.mock.calls[1]?.[0]).toContain("attempts < 5");
    expect(clientQuery.mock.calls[1]?.[0]).toContain("next_attempt_at <= now()");
    expect(clientRelease).toHaveBeenCalledOnce();
  });

  it("records provider failures and delays retry with a stable idempotency key", async () => {
    sendPaymentNotification.mockRejectedValue(
      new NotificationDeliveryError("RESEND_REJECTED", "Resend rejected the email (HTTP 503)", 503)
    );

    await expect(deliverPendingPaymentNotifications()).resolves.toEqual({
      sent: 0,
      failed: 1,
      failureCodes: ["RESEND_REJECTED:HTTP_503"],
    });

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("next_attempt_at = now() + make_interval"),
      [outboxRow.id, "RESEND_REJECTED:HTTP_503"]
    );
  });
});
