import { query } from "../../db.js";
import { recordVerification } from "../verification/index.js";

// Only an authorized staff member (checked via RBAC middleware upstream)
// may call this. A customer must never be able to mark their own cash
// payment as received.
export async function recordCashPayment(params: {
  paymentId: string;
  staffId: string;
  businessLocationId: string;
  amountCents: number;
  expectedCents: number;
  notes?: string;
}) {
  await query(
    `INSERT INTO payment_transactions (payment_id, received_by, business_location_id, received_at, notes)
     VALUES ($1,$2,$3, now(), $4)`,
    [params.paymentId, params.staffId, params.businessLocationId, params.notes ?? null]
  );

  const discrepancy = params.amountCents - params.expectedCents;

  await query(
    `INSERT INTO payment_reconciliation (payment_id, expected_cents, recorded_cents, discrepancy_cents, status)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      params.paymentId,
      params.expectedCents,
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
