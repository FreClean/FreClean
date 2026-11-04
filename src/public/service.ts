import { query, pool } from "../db.js";

export interface PublicEnquiryInput {
  type: "SERVICE" | "CONTACT";
  fullName: string;
  email: string;
  phone?: string;
  service?: string;
  message: string;
  spamHash: string;
  sourceOrigin: string;
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
        (enquiry_type, full_name, email, phone, service, message, spam_hash, source_origin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [input.type, input.fullName, input.email, input.phone ?? null, input.service ?? null,
        input.message, input.spamHash, input.sourceOrigin]
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
