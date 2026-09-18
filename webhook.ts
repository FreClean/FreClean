import crypto from "node:crypto";
import { query } from "../../db.js";
import { recordVerification } from "../verification/index.js";

// Verify the processor's webhook signature before trusting the payload.
// This is illustrative — swap for your processor's actual signature scheme.
export function verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

interface CardWebhookEvent {
  eventId: string;       // for idempotency / replay protection
  chargeId: string;
  paymentId: string;     // your internal payment id, from metadata
  amountCents: number;
  status: "succeeded" | "failed";
}

export async function handleCardWebhook(event: CardWebhookEvent, expectedAmountCents: number) {
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

  if (event.status === "succeeded" && event.amountCents === expectedAmountCents) {
    await recordVerification(event.paymentId, "PASSED");
  } else {
    await recordVerification(event.paymentId, "FAILED", "processor reported failure or amount mismatch");
  }

  return { ok: true };
}
