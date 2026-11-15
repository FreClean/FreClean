import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPaymentNotification } from "./email.js";

const originalEnvironment = { ...process.env };
const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  fetchMock.mockReset();
});

describe("payment notification delivery", () => {
  it("sends verified payment details with a deterministic idempotency key", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "FreClean <payments@example.com>";
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendPaymentNotification({
      paymentId: "payment-1",
      customerName: "Test Customer",
      customerEmail: "customer@example.com",
      orderId: "order-1",
      bookingId: null,
      amount: "20.00",
      network: "TRC20",
      transactionHash: "a".repeat(64),
      status: "PAID",
      recipientType: "CUSTOMER",
    }, "customer@example.com");

    const [, options] = fetchMock.mock.calls[0]!;
    expect(options.headers["Idempotency-Key"]).toBe("payment-payment-1-customer");
    const email = JSON.parse(options.body);
    expect(email.subject).toBe("USDT payment confirmed");
    expect(email.text).toContain("Order/booking: Order order-1");
    expect(email.text).toContain("Amount: 20.00 USDT");
    expect(email.text).toContain("Network: TRC20");
    expect(email.text).toContain("Payment status: PAID");
  });

  it("surfaces provider rejection instead of silently reporting delivery", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "FreClean <payments@example.com>";
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendPaymentNotification({
      paymentId: "payment-2",
      customerName: "Test Customer",
      customerEmail: "customer@example.com",
      orderId: null,
      bookingId: "booking-1",
      amount: "20.00",
      network: "CELO",
      transactionHash: "b".repeat(64),
      status: "PAID",
      recipientType: "ADMIN",
    }, "contact@freclean.com")).rejects.toThrow(/HTTP 503/);
  });
});
