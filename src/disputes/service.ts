import { randomUUID } from "node:crypto";
import { query, pool } from "../db.js";
import { canTransition, type DisputeStatus } from "./model.js";

export async function createDispute(input: { customerId: string; category: string; description: string; country?: string; currency?: string; orderId?: string; orderItemId?: string; paymentId?: string; bookingId?: string; productId?: string; }) {
  const reference = `DSP-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const rows = await query(`INSERT INTO disputes (public_reference, customer_id, category, description, country, currency, order_id, order_item_id, payment_id, booking_id, product_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, public_reference AS "publicReference", customer_id AS "customerId", category, description, status, priority, country, currency, created_at AS "createdAt"`, [reference, input.customerId, input.category, input.description, input.country ?? null, input.currency ?? "USD", input.orderId ?? null, input.orderItemId ?? null, input.paymentId ?? null, input.bookingId ?? null, input.productId ?? null]);
  await query("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,'DISPUTE_CREATED','DISPUTE',$2,$3)", [input.customerId, rows[0].id, JSON.stringify({ category: input.category })]);
  return rows[0];
}

export async function listDisputes(userId: string, canViewAll: boolean) { return query("SELECT id, public_reference AS \"publicReference\", customer_id AS \"customerId\", category, status, priority, assigned_to AS \"assignedTo\", created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM disputes WHERE ($1::boolean OR customer_id = $2 OR assigned_to = $2) ORDER BY created_at DESC", [canViewAll, userId]); }

export async function getDispute(id: string, userId: string, canViewAll: boolean) {
  const rows = await query("SELECT * FROM disputes WHERE id = $1 AND ($2::boolean OR customer_id = $3 OR assigned_to = $3)", [id, canViewAll, userId]);
  if (!rows[0]) return null;
  await query("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,'DISPUTE_VIEWED','DISPUTE',$2,$3)", [userId, id, JSON.stringify({ sensitive: canViewAll })]);
  const messages = await query("SELECT id, sender_id AS \"senderId\", visibility, message, created_at AS \"createdAt\" FROM dispute_messages WHERE dispute_id = $1 AND (visibility = 'CUSTOMER' OR $2::boolean) ORDER BY created_at ASC", [id, canViewAll]);
  return { ...rows[0], messages };
}

export async function transitionDispute(id: string, actorId: string, from: DisputeStatus, to: DisputeStatus, note?: string) {
  if (!canTransition(from, to)) throw Object.assign(new Error("Invalid dispute status transition"), { status: 409 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("UPDATE disputes SET status = $1, updated_at = now(), acknowledged_at = CASE WHEN $1 = 'ACKNOWLEDGED' THEN now() ELSE acknowledged_at END, investigation_at = CASE WHEN $1 = 'INVESTIGATING' THEN now() ELSE investigation_at END, resolution_at = CASE WHEN $1 = 'RESOLVED' THEN now() ELSE resolution_at END, closed_at = CASE WHEN $1 = 'CLOSED' THEN now() ELSE closed_at END WHERE id = $2 AND status = $3 RETURNING id", [to, id, from]);
    if (!result.rowCount) throw Object.assign(new Error("Dispute was changed or not found"), { status: 409 });
    await client.query("INSERT INTO dispute_status_history (dispute_id, from_status, to_status, changed_by, note) VALUES ($1,$2,$3,$4,$5)", [id, from, to, actorId, note ?? null]);
    await client.query("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,'DISPUTE_STATUS_CHANGED','DISPUTE',$2,$3)", [actorId, id, JSON.stringify({ from, to })]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function addMessage(disputeId: string, senderId: string, message: string, visibility: "CUSTOMER" | "INTERNAL") {
  const rows = await query("INSERT INTO dispute_messages (dispute_id, sender_id, visibility, message) VALUES ($1,$2,$3,$4) RETURNING id, sender_id AS \"senderId\", visibility, message, created_at AS \"createdAt\"", [disputeId, senderId, visibility, message]);
  await query("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,'DISPUTE_MESSAGE_CREATED','DISPUTE',$2,$3)", [senderId, disputeId, JSON.stringify({ visibility })]);
  return rows[0];
}