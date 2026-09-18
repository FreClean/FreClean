import { query } from "../../db.js";
import { recordVerification } from "../verification/index.js";

// Only an authorized staff member (checked via RBAC middleware upstream)
// may call this. A customer must never be able to mark their own cash
// payment as received.
export async function recordCashPayment(params: {
  paymentId: string;
  userId: string;
  businessLocationId: string;
  amountCents: number;
  notes?: string;
}) {
  const [staff] = await query<{ id: string }>(
    "SELECT id FROM staff WHERE user_id = $1 AND active = true",
    [params.userId]
  );
  const [payment] = await query<{ amount_cents: number; method: string }>(
    "SELECT amount_cents, method FROM payments WHERE id = $1",
    [params.paymentId]
  );
  if (!staff || !payment || payment.method !== "CASH") {
    throw Object.assign(new Error("Cash payment is not available"), { status: 400 });
  }

  await query(
    `INSERT INTO payment_transactions (payment_id, received_by, business_location_id, received_at, notes)
     VALUES ($1,$2,$3, now(), $4)`,
    [params.paymentId, staff.id, params.businessLocationId, params.notes ?? null]
  );

  const discrepancy = params.amountCents - payment.amount_cents;

  await query(
    `INSERT INTO payment_reconciliation (payment_id, expected_cents, recorded_cents, discrepancy_cents, status)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      params.paymentId,
      payment.amount_cents,
      params.amountCents,
      discrepancy,
      discrepancy === 0 ? "RECORDED" : "DISCREPANCY",
    ]
  );

  if (discrepancy === 0) {
    await recordVerification(params.paymentId, "PASSED");
  } else {
    // Recorded but flagged — a manager must resolve the discrepancy before
    // the payment counts as verified.
    await recordVerification(params.paymentId, "FAILED", `discrepancy of ${discrepancy} cents`);
  }
}
