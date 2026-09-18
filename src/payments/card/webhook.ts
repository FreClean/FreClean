import { query } from "../../db.js";
import { recordVerification } from "../verification/index.js";
export { verifyWebhookSignature } from "./signature.js";

export interface CardWebhookEvent {
  eventId: string;       // for idempotency / replay protection
  chargeId: string;
  paymentId: string;     // your internal payment id, from metadata
  amountCents: number;
  status: "succeeded" | "failed";
}

export async function handleCardWebhook(event: CardWebhookEvent) {
  const [payment] = await query<{ amount_cents: number }>(
    "SELECT amount_cents FROM payments WHERE id = $1 AND method = 'CARD'",
    [event.paymentId]
  );
  if (!payment) return { ok: false, error: "Unknown payment" };

  const seen = await query(
    `SELECT id FROM payment_transactions WHERE processor_event_id = $1`,
    [event.eventId]
  );
  if (seen.length > 0) {
    return { ok: true, note: "duplicate event ignored (idempotent)" };
  }

  await query(
    `INSERT INTO payment_transactions (payment_id, processor_charge_id, processor_event_id)
     VALUES ($1,$2,$3)`,
    [event.paymentId, event.chargeId, event.eventId]
  );

  if (event.status === "succeeded" && event.amountCents === payment.amount_cents) {
    await recordVerification(event.paymentId, "PASSED");
  } else {
    await recordVerification(event.paymentId, "FAILED", "processor reported failure or amount mismatch");
  }

  return { ok: true };
}
