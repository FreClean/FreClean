import { query, pool } from "../db.js";
import type { PublicEnquiryEmail } from "./email.js";

export interface PublicEnquiryInput {
  type: "SERVICE" | "CONTACT";
  fullName: string;
  email: string;
  phone?: string;
  service?: string;
  propertyType?: string;
  spaceSize?: string;
  date?: string;
  time?: string;
  location?: string;
  notes?: string;
  paymentMethod?: string;
  message: string;
  spamHash: string;
  sourceOrigin: string;
}

export interface PublicEnquiryRecord {
  id: string;
  enquiry_type: "SERVICE" | "CONTACT";
  full_name: string;
  email: string;
  phone: string | null;
  service: string | null;
  property_type: string | null;
  space_size: string | null;
  requested_date: string | null;
  requested_time: string | null;
  location: string | null;
  notes: string | null;
  payment_method: string | null;
  message: string;
  status: "NEW" | "CONTACTED" | "CLOSED" | "SPAM";
  source_origin: string;
  created_at: string;
  updated_at: string;
  notification_status?: "PENDING" | "SENDING" | "SENT" | "FAILED" | null;
  notification_attempts?: number | null;
}

export async function listPublicEnquiries(): Promise<PublicEnquiryRecord[]> {
  return query<PublicEnquiryRecord>(
    `SELECT e.id, e.enquiry_type, e.full_name, e.email, e.phone, e.service, e.property_type,
            e.space_size, e.requested_date, e.requested_time, e.location, e.notes,
            e.payment_method, e.message, e.status, e.source_origin, e.created_at, e.updated_at,
            n.status AS notification_status, n.attempts AS notification_attempts
       FROM public_enquiries e
       LEFT JOIN public_enquiry_notification_outbox n ON n.enquiry_id = e.id
       ORDER BY e.created_at DESC
       LIMIT 500`
  );
}

export async function updatePublicEnquiryStatus(
  id: string,
  status: "NEW" | "CONTACTED" | "CLOSED" | "SPAM"
): Promise<PublicEnquiryRecord | null> {
  const [updated] = await query<PublicEnquiryRecord>(
    `UPDATE public_enquiries
        SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING id, enquiry_type, full_name, email, phone, service, property_type,
                space_size, requested_date, requested_time, location, notes,
                payment_method, message, status, source_origin, created_at, updated_at`,
    [id, status]
  );
  return updated ?? null;
}

export async function createPublicEnquiry(input: PublicEnquiryInput): Promise<string> {
  const recipientEmail = process.env.CONTACT_EMAIL?.trim();
  if (!recipientEmail) {
    throw Object.assign(new Error("CONTACT_EMAIL is not configured"), { status: 503 });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.spamHash]);
    const recent = await client.query(
      `SELECT id FROM public_enquiries
       WHERE spam_hash = $1 AND created_at > now() - interval '10 minutes'
       LIMIT 1`,
      [input.spamHash]
    );
    if (recent.rows.length > 0) {
      throw Object.assign(new Error("Duplicate request"), { status: 409 });
    }

    const inserted = await client.query<{ id: string; created_at: Date | string }>(
      `INSERT INTO public_enquiries
        (enquiry_type, full_name, email, phone, service, property_type, space_size,
         requested_date, requested_time, location, notes, payment_method, message,
         spam_hash, source_origin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, created_at`,
      [input.type, input.fullName, input.email, input.phone ?? null, input.service ?? null,
        input.propertyType ?? null, input.spaceSize ?? null, input.date ?? null,
        input.time ?? null, input.location ?? null, input.notes ?? null,
        input.paymentMethod ?? null, input.message, input.spamHash, input.sourceOrigin]
    );
    const record = inserted.rows[0];
    if (!record) throw new Error("Public enquiry insert returned no record");
    const notification: PublicEnquiryEmail = {
      type: input.type,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      service: input.service,
      propertyType: input.propertyType,
      spaceSize: input.spaceSize,
      date: input.date,
      time: input.time,
      location: input.location,
      paymentMethod: input.paymentMethod,
      notes: input.notes,
      message: input.message,
      submittedAt: record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
    };
    await client.query(
      `INSERT INTO public_enquiry_notification_outbox
        (enquiry_id, recipient_email, payload)
       VALUES ($1, $2, $3::jsonb)`,
      [record.id, recipientEmail, JSON.stringify(notification)]
    );
    await client.query("COMMIT");
    return record.id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
