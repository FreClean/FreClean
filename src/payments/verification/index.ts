import { query } from "../../db.js";

// Fail-closed: verification returning anything other than an explicit
// "passed" result must leave the payment unverified. Never default to true.
export async function recordVerification(paymentId: string, result: "PASSED" | "FAILED", reason?: string) {
  await query(
    `INSERT INTO payment_verification_events (payment_id, result, reason) VALUES ($1,$2,$3)`,
    [paymentId, result, reason ?? null]
  );

  if (result === "PASSED") {
    await query(
      `UPDATE payments SET verification_status = 'VERIFIED', status = 'VERIFIED', updated_at = now()
       WHERE id = $1`,
      [paymentId]
    );
  } else {
    await query(
      `UPDATE payments SET verification_status = 'FAILED', status = 'FAILED', updated_at = now()
       WHERE id = $1`,
      [paymentId]
    );
  }
}
