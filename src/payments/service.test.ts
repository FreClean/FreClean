import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolConnect = vi.hoisted(() => vi.fn());
const dbQuery = vi.hoisted(() => vi.fn());
const clientQuery = vi.hoisted(() => vi.fn());
const clientRelease = vi.hoisted(() => vi.fn());
const verifyUsdtTransfer = vi.hoisted(() => vi.fn());

vi.mock("../db.js", () => ({
  pool: { connect: poolConnect },
  query: dbQuery,
}));
vi.mock("./crypto/verify.js", () => ({ verifyUsdtTransfer }));

import { confirmPayment, createPayment, submitTransactionHash } from "./service.js";
import { usdtNetworkConfig } from "./config.js";

const originalEnvironment = { ...process.env };

const paymentRow = {
  id: "00000000-0000-4000-8000-000000000001",
  customer_id: "00000000-0000-4000-8000-000000000002",
  order_id: "00000000-0000-4000-8000-000000000003",
  booking_id: null,
  method: "USDT" as const,
  asset: "USDT" as const,
  network: "TRC20" as const,
  amount: "12.34",
  currency: "USDT",
  receiving_address: "TSnbTib4DAEpGbesxUzjN2pgtcJigs8veR",
  transaction_hash: null,
  status: "PENDING",
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
  verified_at: null,
};

function prepareCreatePayment(method: "USDT" | "CELOHT_DAPP" = "USDT") {
  dbQuery.mockResolvedValueOnce([]);
  clientQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{
        id: paymentRow.order_id,
        customer_id: paymentRow.customer_id,
        amount_cents: 1234,
        currency: "USD",
        status: "CHECKOUT",
        payment_status: "UNPAID",
      }],
    })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{
        ...paymentRow,
        method,
        asset: method === "USDT" ? "USDT" : null,
        network: method === "USDT" ? "TRC20" : null,
        currency: method === "USDT" ? "USDT" : "USD",
        receiving_address: method === "USDT" ? paymentRow.receiving_address : null,
      }],
    })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease });
}

beforeEach(() => {
  poolConnect.mockReset();
  dbQuery.mockReset();
  clientQuery.mockReset();
  clientRelease.mockReset();
  verifyUsdtTransfer.mockReset();
  delete process.env.CELOHT_DAPP_URL;
  process.env.USDT_PAYMENTS_ENABLED = "true";
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe("payment creation", () => {
  it("uses only the four supplied USDT receiving addresses", () => {
    expect(usdtNetworkConfig.BEP20.receivingAddress).toBe("0xcbe30a91dbc6a2423c30d8c8dd0547b8dcb0e044");
    expect(usdtNetworkConfig.TRC20.receivingAddress).toBe("TSnbTib4DAEpGbesxUzjN2pgtcJigs8veR");
    expect(usdtNetworkConfig.SOLANA.receivingAddress).toBe("33FM1eKWBNWfA6qDf1EFZ8Ab6U6RiXhJkG6NyFL1wTYf");
    expect(usdtNetworkConfig.CELO.receivingAddress).toBe("0xcbe30a91dbc6a2423c30d8c8dd0547b8dcb0e044");
  });

  it("uses the authoritative order total and configured network address", async () => {
    prepareCreatePayment();
    const result = await createPayment({
      customerId: paymentRow.customer_id,
      orderId: paymentRow.order_id!,
      method: "USDT",
      network: "TRC20",
      idempotencyKey: "checkout-1234",
    });

    expect(result.payment.amount).toBe("12.34");
    expect(result.payment.receivingAddress).toBe("TSnbTib4DAEpGbesxUzjN2pgtcJigs8veR");
    expect(result.payment.paymentMethod).toBe("USDT");
    expect(result.networkDetails).toMatchObject({ warning: expect.stringContaining("permanent loss of funds") });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO payments"),
      expect.arrayContaining([1234, "USDT", "TSnbTib4DAEpGbesxUzjN2pgtcJigs8veR", "checkout-1234"])
    );
    expect(clientRelease).toHaveBeenCalledOnce();
  });

  it("prevents creating a second active payment for the same order", async () => {
    dbQuery.mockResolvedValueOnce([]);
    poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: paymentRow.order_id,
          customer_id: paymentRow.customer_id,
          amount_cents: 1234,
          currency: "USD",
          status: "CHECKOUT",
          payment_status: "PENDING",
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: paymentRow.id }] });

    await expect(createPayment({
      customerId: paymentRow.customer_id,
      orderId: paymentRow.order_id!,
      method: "USDT",
      network: "TRC20",
      idempotencyKey: "checkout-duplicate",
    })).rejects.toMatchObject({ status: 409 });
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO payments"),
      expect.anything()
    );
  });

  it("keeps CeloHT DApp as a distinct method without assigning a USDT network", async () => {
    process.env.CELOHT_DAPP_URL = "https://celoht.example/checkout";
    prepareCreatePayment("CELOHT_DAPP");
    const result = await createPayment({
      customerId: paymentRow.customer_id,
      orderId: paymentRow.order_id!,
      method: "CELOHT_DAPP",
      idempotencyKey: "celoht-1234",
    });

    expect(result.payment.paymentMethod).toBe("CELOHT_DAPP");
    expect(result.payment.asset).toBeNull();
    expect(result.payment.network).toBeNull();
    expect(result.networkDetails).toEqual({
      name: "CeloHT DApp",
      checkoutUrl: "https://celoht.example/checkout",
    });
  });

  it("rejects invalid CeloHT URLs and disallows unsupported payment methods at the type boundary", async () => {
    process.env.CELOHT_DAPP_URL = "javascript:alert(1)";
    await expect(createPayment({
      customerId: paymentRow.customer_id,
      orderId: paymentRow.order_id!,
      method: "CELOHT_DAPP",
      idempotencyKey: "celoht-5678",
    })).rejects.toMatchObject({ status: 503 });
  });

  it("requires manual confirmation after chain verification succeeds", async () => {
    const verifiedPayment = { ...paymentRow, status: "VERIFYING", verified_at: new Date("2026-01-01T00:01:00Z") };
    dbQuery
      .mockResolvedValueOnce([paymentRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([verifiedPayment]);
    verifyUsdtTransfer.mockResolvedValue({ status: "PAID", confirmations: 20 });
    poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [paymentRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await submitTransactionHash({
      paymentId: paymentRow.id,
      customerId: paymentRow.customer_id,
      transactionHash: "a".repeat(64),
    });

    expect(result.status).toBe("VERIFYING");
    expect(verifyUsdtTransfer).toHaveBeenCalledWith({
      network: "TRC20",
      transactionHash: "a".repeat(64),
      amount: "12.34",
    });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("verification_status = 'VERIFIED'"),
      [paymentRow.id]
    );
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO payment_notification_outbox"),
      expect.anything()
    );
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("payment_status = 'PAID'"),
      expect.anything()
    );
  });

  it("manually confirms a chain-verified payment and records the administrator action", async () => {
    const verifiedPayment = {
      ...paymentRow,
      status: "VERIFYING",
      verification_status: "VERIFIED",
      transaction_hash: "e".repeat(64),
    };
    process.env.CONTACT_EMAIL = "contact@freclean.com";
    poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [verifiedPayment] })
      .mockResolvedValueOnce({ rows: [{ full_name: "Test Customer", email: "customer@example.com" }] })
      .mockResolvedValueOnce({ rows: [{ ...verifiedPayment, status: "PAID" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await confirmPayment({
      paymentId: paymentRow.id,
      adminId: "00000000-0000-4000-8000-000000000004",
      confirmationNote: "Matched the receipt in the verified network explorer.",
    });

    expect(result.status).toBe("PAID");
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("PAYMENT_MANUALLY_CONFIRMED"),
      expect.arrayContaining(["00000000-0000-4000-8000-000000000004", paymentRow.id])
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO payment_notification_outbox"),
      expect.arrayContaining([paymentRow.id, "customer@example.com", expect.any(String), "contact@freclean.com"])
    );
  });

  it("allows manual confirmation of CeloHT only through the administrator flow", async () => {
    const celohtPayment = {
      ...paymentRow,
      method: "CELOHT_DAPP" as const,
      asset: null,
      network: null,
      receiving_address: null,
      currency: "USD",
      status: "PENDING",
    };
    process.env.CONTACT_EMAIL = "contact@freclean.com";
    poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [celohtPayment] })
      .mockResolvedValueOnce({ rows: [{ full_name: "Test Customer", email: "customer@example.com" }] })
      .mockResolvedValueOnce({ rows: [{ ...celohtPayment, status: "PAID" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await confirmPayment({
      paymentId: paymentRow.id,
      adminId: "00000000-0000-4000-8000-000000000004",
      confirmationNote: "Checked the separate CeloHT settlement record.",
    });

    expect(result.status).toBe("PAID");
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("PAYMENT_MANUALLY_CONFIRMED"),
      expect.arrayContaining([expect.any(String), paymentRow.id])
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO payment_notification_outbox"),
      expect.arrayContaining([paymentRow.id, "customer@example.com", expect.any(String), "contact@freclean.com"])
    );
  });

  it("keeps a not-yet-final transaction in VERIFYING without queuing a confirmation", async () => {
    const verifyingPayment = { ...paymentRow, status: "VERIFYING" };
    dbQuery
      .mockResolvedValueOnce([paymentRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([verifyingPayment]);
    verifyUsdtTransfer.mockResolvedValue({ status: "VERIFYING", confirmations: 3 });
    poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease });
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [paymentRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await submitTransactionHash({
      paymentId: paymentRow.id,
      customerId: paymentRow.customer_id,
      transactionHash: "b".repeat(64),
    });

    expect(result.status).toBe("VERIFYING");
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO payment_notification_outbox"),
      expect.anything()
    );
  });

  it("rejects transaction replay before contacting a chain provider", async () => {
    dbQuery
      .mockResolvedValueOnce([paymentRow])
      .mockResolvedValueOnce([{ payment_id: "00000000-0000-4000-8000-000000000099" }]);
    await expect(submitTransactionHash({
      paymentId: paymentRow.id,
      customerId: paymentRow.customer_id,
      transactionHash: "c".repeat(64),
    })).rejects.toMatchObject({ status: 409 });
    expect(verifyUsdtTransfer).not.toHaveBeenCalled();
    expect(poolConnect).not.toHaveBeenCalled();
  });

  it("does not accept a customer-submitted hash as CeloHT DApp verification", async () => {
    dbQuery.mockResolvedValueOnce([{
      ...paymentRow,
      method: "CELOHT_DAPP",
      asset: null,
      network: null,
      receiving_address: null,
    }]);
    await expect(submitTransactionHash({
      paymentId: paymentRow.id,
      customerId: paymentRow.customer_id,
      transactionHash: "d".repeat(64),
    })).rejects.toMatchObject({ status: 400 });
    expect(verifyUsdtTransfer).not.toHaveBeenCalled();
  });
});
