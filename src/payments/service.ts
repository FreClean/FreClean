import { pool, query } from "../db.js";
import { getPaymentNetworkConfig } from "./config.js";
import type { PaymentMethod, PaymentNetwork } from "./model.js";
import { verifyUsdtTransfer } from "./crypto/verify.js";

interface PaymentRow {
  id: string;
  customer_id: string;
  order_id: string | null;
  booking_id: string | null;
  method: PaymentMethod;
  asset: "USDT" | null;
  network: PaymentNetwork | null;
  amount: string;
  currency: string;
  receiving_address: string | null;
  transaction_hash: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  verified_at: Date | null;
}

function presentPayment(row: PaymentRow) {
  const explorer = row.network ? getPaymentNetworkConfig(row.network).explorer : null;
  return {
    id: row.id,
    customerId: row.customer_id,
    orderId: row.order_id,
    bookingId: row.booking_id,
    paymentMethod: row.method,
    asset: row.asset,
    network: row.network,
    amount: row.amount,
    currency: row.currency,
    receivingAddress: row.receiving_address,
    transactionHash: row.transaction_hash,
    transactionExplorerUrl: explorer && row.transaction_hash ? `${explorer}${row.transaction_hash}` : null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verifiedAt: row.verified_at,
  };
}

function normalizeIdempotencyKey(value: string): string {
  const key = value.trim();
  if (!/^[\w.-]{8,128}$/.test(key)) {
    throw Object.assign(new Error("Idempotency-Key must be 8-128 letters, digits, dots, underscores, or hyphens"), { status: 400 });
  }
  return key;
}

export async function createPayment(input: {
  customerId: string;
  orderId?: string;
  bookingId?: string;
  method: PaymentMethod;
  network?: PaymentNetwork;
  idempotencyKey: string;
}) {
  if (Boolean(input.orderId) === Boolean(input.bookingId)) {
    throw Object.assign(new Error("Provide exactly one orderId or bookingId"), { status: 400 });
  }
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (input.method === "USDT" && !input.network) {
    throw Object.assign(new Error("A USDT network is required"), { status: 400 });
  }
  let celohtDappUrl: string | undefined;
  if (input.method === "CELOHT_DAPP") {
    try {
      const parsed = new URL(process.env.CELOHT_DAPP_URL ?? "");
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
      celohtDappUrl = parsed.toString();
    } catch {
      throw Object.assign(new Error("CeloHT DApp checkout is not configured with a valid HTTPS URL"), { status: 503 });
    }
  }

  const [existingPayment] = await query<PaymentRow>(
    `SELECT id, customer_id, order_id, booking_id, method, asset, network,
            amount::text, currency, receiving_address, transaction_hash, status,
            created_at, updated_at, verified_at
     FROM payments WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  if (existingPayment) {
    if (existingPayment.customer_id !== input.customerId ||
        existingPayment.order_id !== (input.orderId ?? null) ||
        existingPayment.booking_id !== (input.bookingId ?? null) ||
        existingPayment.method !== input.method ||
        existingPayment.network !== (input.network ?? null)) {
      throw Object.assign(new Error("Idempotency-Key has already been used for a different payment"), { status: 409 });
    }
    const config = existingPayment.network ? getPaymentNetworkConfig(existingPayment.network) : null;
    return {
      payment: presentPayment(existingPayment),
      networkDetails: config
        ? {
          name: config.label,
          tokenIdentifier: config.tokenIdentifier,
          explorerTransactionBaseUrl: config.explorer,
          warning: "Send USDT only through the selected network. Sending funds through another network may result in permanent loss of funds.",
        }
        : { name: "CeloHT DApp", checkoutUrl: celohtDappUrl },
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const targetQuery = input.orderId
      ? `SELECT id, customer_id, total_cents AS amount_cents, currency, status, payment_status
         FROM orders WHERE id = $1 FOR UPDATE`
      : `SELECT id, customer_id, price_cents AS amount_cents, currency, status, payment_status
         FROM bookings WHERE id = $1 FOR UPDATE`;
    const targetId = input.orderId ?? input.bookingId;
    const target = (await client.query<{
      id: string;
      customer_id: string;
      amount_cents: number;
      currency: string;
      status: string;
      payment_status: string;
    }>(targetQuery, [targetId])).rows[0];
    if (!target || target.customer_id !== input.customerId) {
      throw Object.assign(new Error("Order or booking is not available"), { status: 404 });
    }
    const idempotentRetry = (await client.query<PaymentRow>(
      `SELECT id, customer_id, order_id, booking_id, method, asset, network,
              amount::text, currency, receiving_address, transaction_hash, status,
              created_at, updated_at, verified_at
       FROM payments WHERE idempotency_key = $1`,
      [idempotencyKey]
    )).rows[0];
    if (idempotentRetry) {
      if (idempotentRetry.customer_id !== input.customerId ||
          idempotentRetry.order_id !== (input.orderId ?? null) ||
          idempotentRetry.booking_id !== (input.bookingId ?? null) ||
          idempotentRetry.method !== input.method ||
          idempotentRetry.network !== (input.network ?? null)) {
        throw Object.assign(new Error("Idempotency-Key has already been used for a different payment"), { status: 409 });
      }
      await client.query("COMMIT");
      const config = idempotentRetry.network ? getPaymentNetworkConfig(idempotentRetry.network) : null;
      return {
        payment: presentPayment(idempotentRetry),
        networkDetails: config
          ? {
            name: config.label,
            tokenIdentifier: config.tokenIdentifier,
            explorerTransactionBaseUrl: config.explorer,
            warning: "Send USDT only through the selected network. Sending funds through another network may result in permanent loss of funds.",
          }
          : { name: "CeloHT DApp", checkoutUrl: celohtDappUrl },
      };
    }
    if (target.payment_status === "PAID" ||
        (input.orderId && !["CHECKOUT", "PAYMENT_PENDING"].includes(target.status)) ||
        (input.bookingId && ["CANCELLED", "REJECTED"].includes(target.status))) {
      throw Object.assign(new Error("Order or booking is not accepting payment"), { status: 409 });
    }
    if (!Number.isSafeInteger(target.amount_cents) || target.amount_cents <= 0 || target.currency !== "USD") {
      throw Object.assign(new Error("Payment amount or currency is not supported"), { status: 400 });
    }
    const targetColumn = input.orderId ? "order_id" : "booking_id";
    const activePayment = (await client.query<{ id: string }>(
      `SELECT id FROM payments
       WHERE ${targetColumn} = $1
         AND method IN ('USDT','CELOHT_DAPP')
         AND status IN ('PENDING','VERIFYING','PAID')
       LIMIT 1 FOR UPDATE`,
      [targetId]
    )).rows[0];
    if (activePayment) {
      throw Object.assign(new Error("Order or booking already has an active payment"), { status: 409 });
    }

    const amount = (target.amount_cents / 100).toFixed(2);
    const networkConfig = input.method === "USDT"
      ? getPaymentNetworkConfig(input.network!)
      : null;
    const inserted = await client.query<PaymentRow>(
      `INSERT INTO payments
         (customer_id, order_id, booking_id, method, asset, network, amount,
          amount_cents, currency, receiving_address, status, verification_status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING','UNVERIFIED',$11)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, customer_id, order_id, booking_id, method, asset, network,
                 amount::text, currency, receiving_address, transaction_hash, status,
                 created_at, updated_at, verified_at`,
      [
        input.customerId,
        input.orderId ?? null,
        input.bookingId ?? null,
        input.method,
        networkConfig ? "USDT" : null,
        input.network ?? null,
        amount,
        target.amount_cents,
        networkConfig ? "USDT" : target.currency,
        networkConfig?.receivingAddress ?? null,
        idempotencyKey,
      ]
    );
    const payment = inserted.rows[0] ?? (await client.query<PaymentRow>(
      `SELECT id, customer_id, order_id, booking_id, method, asset, network,
              amount::text, currency, receiving_address, transaction_hash, status,
              created_at, updated_at, verified_at
       FROM payments WHERE idempotency_key = $1`,
      [idempotencyKey]
    )).rows[0];
    if (!payment || payment.customer_id !== input.customerId ||
        payment.order_id !== (input.orderId ?? null) ||
        payment.booking_id !== (input.bookingId ?? null) ||
        payment.method !== input.method ||
        payment.network !== (input.network ?? null)) {
      throw Object.assign(new Error("Idempotency-Key has already been used for a different payment"), { status: 409 });
    }

    await client.query(
      `UPDATE ${input.orderId ? "orders" : "bookings"} SET payment_status = $2, updated_at = now()
       WHERE id = $1`,
      [targetId, "PENDING"]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1,'PAYMENT_CREATED','PAYMENT',$2,$3::jsonb)`,
      [
        input.customerId,
        payment.id,
        JSON.stringify({ method: payment.method, network: payment.network, amount: payment.amount }),
      ]
    );
    await client.query("COMMIT");

    return {
      payment: presentPayment(payment),
      networkDetails: networkConfig
        ? {
          name: networkConfig.label,
          tokenIdentifier: networkConfig.tokenIdentifier,
          explorerTransactionBaseUrl: networkConfig.explorer,
          warning: "Send USDT only through the selected network. Sending funds through another network may result in permanent loss of funds.",
        }
        : {
          name: "CeloHT DApp",
          checkoutUrl: celohtDappUrl,
        },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw Object.assign(new Error("Transaction hash or idempotency key has already been used"), { status: 409 });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getPayment(paymentId: string, customerId: string) {
  const [payment] = await query<PaymentRow>(
    `SELECT id, customer_id, order_id, booking_id, method, asset, network,
            amount::text, currency, receiving_address, transaction_hash, status,
            created_at, updated_at, verified_at
     FROM payments WHERE id = $1 AND customer_id = $2`,
    [paymentId, customerId]
  );
  return payment ? presentPayment(payment) : null;
}

export async function listPayments(limit: number) {
  const rows = await query<PaymentRow & {
    customer_name: string;
    customer_email: string;
  }>(
    `SELECT p.id, p.customer_id, p.order_id, p.booking_id, p.method, p.asset, p.network,
            p.amount::text, p.currency, p.receiving_address, p.transaction_hash, p.status,
            p.created_at, p.updated_at, p.verified_at,
            u.full_name AS customer_name, u.email AS customer_email
     FROM payments p
     JOIN users u ON u.id = p.customer_id
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((row) => ({
    ...presentPayment(row),
    customer: { id: row.customer_id, name: row.customer_name, email: row.customer_email },
  }));
}

export async function submitTransactionHash(input: {
  paymentId: string;
  customerId: string;
  transactionHash: string;
}) {
  const [payment] = await query<PaymentRow>(
    `SELECT id, customer_id, order_id, booking_id, method, asset, network,
            amount::text, currency, receiving_address, transaction_hash, status,
            created_at, updated_at, verified_at
     FROM payments WHERE id = $1 AND customer_id = $2`,
    [input.paymentId, input.customerId]
  );
  if (!payment) throw Object.assign(new Error("Payment not found"), { status: 404 });
  if (payment.method !== "USDT" || !payment.network || payment.asset !== "USDT") {
    throw Object.assign(new Error("Transaction-hash verification is available only for USDT payments"), { status: 400 });
  }
  if (payment.status === "PAID") return presentPayment(payment);
  if (!["PENDING", "VERIFYING"].includes(payment.status)) {
    throw Object.assign(new Error(`Payment cannot be verified from status ${payment.status}`), { status: 409 });
  }
  if (payment.transaction_hash && payment.transaction_hash !== input.transactionHash) {
    throw Object.assign(new Error("A transaction hash has already been submitted for this payment"), { status: 409 });
  }
  const validHash = payment.network === "BEP20" || payment.network === "CELO"
    ? /^0x[0-9a-fA-F]{64}$/.test(input.transactionHash)
    : payment.network === "TRC20"
      ? /^[0-9a-fA-F]{64}$/.test(input.transactionHash)
      : /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(input.transactionHash);
  if (!validHash) throw Object.assign(new Error("Transaction hash format does not match the selected network"), { status: 400 });
  const [usedTransaction] = await query<{ payment_id: string }>(
    "SELECT payment_id FROM payment_transactions WHERE lower(tx_hash) = lower($1)",
    [input.transactionHash]
  );
  if (usedTransaction && usedTransaction.payment_id !== input.paymentId) {
    throw Object.assign(new Error("Transaction hash has already been used"), { status: 409 });
  }

  const reservation = await pool.connect();
  try {
    await reservation.query("BEGIN");
    const updated = await reservation.query(
      `UPDATE payments
       SET transaction_hash = $3, status = 'VERIFYING', updated_at = now()
       WHERE id = $1 AND customer_id = $2
         AND status IN ('PENDING','VERIFYING')
         AND (transaction_hash IS NULL OR transaction_hash = $3)`,
      [input.paymentId, input.customerId, input.transactionHash]
    );
    if (updated.rowCount !== 1) {
      throw Object.assign(new Error("Payment has already received a different transaction hash"), { status: 409 });
    }
    if (payment.order_id) {
      await reservation.query(
        "UPDATE orders SET payment_status = 'VERIFYING', updated_at = now() WHERE id = $1",
        [payment.order_id]
      );
    }
    if (payment.booking_id) {
      await reservation.query(
        "UPDATE bookings SET payment_status = 'VERIFYING', updated_at = now() WHERE id = $1",
        [payment.booking_id]
      );
    }
    await reservation.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1,'PAYMENT_TRANSACTION_SUBMITTED','PAYMENT',$2,$3::jsonb)`,
      [
        input.customerId,
        payment.id,
        JSON.stringify({ network: payment.network, transactionHash: input.transactionHash }),
      ]
    );
    await reservation.query("COMMIT");
  } catch (error) {
    await reservation.query("ROLLBACK");
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw Object.assign(new Error("Transaction hash has already been used"), { status: 409 });
    }
    throw error;
  } finally {
    reservation.release();
  }

  const result = await verifyUsdtTransfer({
    network: payment.network,
    transactionHash: input.transactionHash,
    amount: payment.amount,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query<PaymentRow>(
      `SELECT id, customer_id, order_id, booking_id, method, asset, network,
              amount::text, currency, receiving_address, transaction_hash, status,
              created_at, updated_at, verified_at
       FROM payments WHERE id = $1 FOR UPDATE`,
      [input.paymentId]
    )).rows[0];
    if (!current) throw Object.assign(new Error("Payment not found"), { status: 404 });
    if (current.status === "PAID") {
      await client.query("COMMIT");
      return presentPayment(current);
    }

    if (result.status === "PAID") {
      const adminEmail = process.env.CONTACT_EMAIL?.trim();
      if (!adminEmail) {
        throw Object.assign(new Error("CONTACT_EMAIL is required for payment notifications"), { status: 503 });
      }
      const customer = (await client.query<{ full_name: string; email: string }>(
        "SELECT full_name, email FROM users WHERE id = $1",
        [input.customerId]
      )).rows[0];
      if (!customer) throw new Error("Payment customer could not be loaded for notification");
      const notificationPayload = {
        paymentId: payment.id,
        customerName: customer.full_name,
        customerEmail: customer.email,
        orderId: payment.order_id,
        bookingId: payment.booking_id,
        amount: payment.amount,
        network: payment.network,
        transactionHash: input.transactionHash,
        status: "PAID",
      };
      await client.query(
        `UPDATE payments
         SET status = 'PAID', verification_status = 'VERIFIED', verified_at = now(), updated_at = now()
         WHERE id = $1`,
        [input.paymentId]
      );
      await client.query(
        `INSERT INTO payment_transactions
           (payment_id, tx_hash, chain_id, asset, recipient_address, confirmations)
         VALUES ($1,$2,$3,'USDT',$4,$5)
         ON CONFLICT DO NOTHING`,
        [
          input.paymentId,
          input.transactionHash,
          payment.network,
          payment.receiving_address,
          result.confirmations,
        ]
      );
      await client.query(
        `INSERT INTO payment_verification_events (payment_id, result)
         VALUES ($1,'PASSED')`,
        [input.paymentId]
      );
      if (payment.order_id) {
        await client.query(
          `UPDATE orders
           SET status = CASE WHEN status IN ('CHECKOUT','PAYMENT_PENDING') THEN 'PAID' ELSE status END,
               payment_status = 'PAID', updated_at = now()
           WHERE id = $1`,
          [payment.order_id]
        );
      }
      if (payment.booking_id) {
        await client.query(
          `UPDATE bookings SET payment_status = 'PAID', updated_at = now() WHERE id = $1`,
          [payment.booking_id]
        );
      }
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1,'PAYMENT_VERIFIED','PAYMENT',$2,$3::jsonb)`,
        [
          input.customerId,
          input.paymentId,
          JSON.stringify({ network: payment.network, transactionHash: input.transactionHash }),
        ]
      );
      await client.query(
        `INSERT INTO payment_notification_outbox (payment_id, recipient_type, recipient_email, payload)
         VALUES ($1,'CUSTOMER',$2,$3::jsonb),($1,'ADMIN',$4,$3::jsonb)
         ON CONFLICT (payment_id, recipient_type) DO NOTHING`,
        [
          input.paymentId,
          customer.email,
          JSON.stringify({ ...notificationPayload, recipientType: "CUSTOMER" }),
          adminEmail,
        ]
      );
    } else if (result.status === "FAILED") {
      await client.query(
        `UPDATE payments SET status = 'FAILED', verification_status = 'FAILED', updated_at = now()
         WHERE id = $1`,
        [input.paymentId]
      );
      await client.query(
        `INSERT INTO payment_verification_events (payment_id, result, reason)
         VALUES ($1,'FAILED',$2)`,
        [input.paymentId, result.reason]
      );
      if (payment.order_id) {
        await client.query(
          `UPDATE orders SET payment_status = 'FAILED', updated_at = now() WHERE id = $1`,
          [payment.order_id]
        );
      }
      if (payment.booking_id) {
        await client.query(
          `UPDATE bookings SET payment_status = 'FAILED', updated_at = now() WHERE id = $1`,
          [payment.booking_id]
        );
      }
    } else {
      await client.query(
        `UPDATE payments SET status = 'VERIFYING', updated_at = now() WHERE id = $1`,
        [input.paymentId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updated = await getPayment(input.paymentId, input.customerId);
  if (!updated) throw new Error("Updated payment could not be loaded");
  return updated;
}
