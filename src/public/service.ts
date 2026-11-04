import { query, pool } from "../db.js";

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
}

export async function listPublicEnquiries(): Promise<PublicEnquiryRecord[]> {
  return query<PublicEnquiryRecord>(
    `SELECT id, enquiry_type, full_name, email, phone, service, property_type,
            space_size, requested_date, requested_time, location, notes,
            payment_method, message, status, source_origin, created_at, updated_at
       FROM public_enquiries
       ORDER BY created_at DESC
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
  const recent = await query<{ id: string }>(
    `SELECT id FROM public_enquiries
     WHERE spam_hash = $1 AND created_at > now() - interval '10 minutes'
     LIMIT 1`,
    [input.spamHash]
  );
  if (recent.length > 0) {
    throw Object.assign(new Error("Duplicate request"), { status: 409 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO public_enquiries
        (enquiry_type, full_name, email, phone, service, property_type, space_size,
         requested_date, requested_time, location, notes, payment_method, message,
         spam_hash, source_origin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [input.type, input.fullName, input.email, input.phone ?? null, input.service ?? null,
        input.propertyType ?? null, input.spaceSize ?? null, input.date ?? null,
        input.time ?? null, input.location ?? null, input.notes ?? null,
        input.paymentMethod ?? null, input.message, input.spamHash, input.sourceOrigin]
    );
    await client.query("COMMIT");
    return inserted.rows[0].id as string;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
