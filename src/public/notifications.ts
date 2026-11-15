import { pool } from "../db.js";
import { sendPublicEnquiryEmail, type PublicEnquiryEmail } from "./email.js";

interface OutboxRow {
  id: string;
  recipient_email: string;
  payload: PublicEnquiryEmail;
}

export async function deliverPendingEnquiryNotifications(batchSize = 10) {
  const client = await pool.connect();
  let claimed: OutboxRow[];
  try {
    await client.query("BEGIN");
    const result = await client.query<OutboxRow>(
      `WITH queued AS (
         SELECT id
         FROM public_enquiry_notification_outbox
         WHERE (status = 'PENDING'
                OR (status = 'FAILED' AND next_attempt_at <= now())
                OR (status = 'SENDING' AND updated_at < now() - INTERVAL '5 minutes'))
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE public_enquiry_notification_outbox n
       SET status = 'SENDING', attempts = attempts + 1, updated_at = now()
       FROM queued
       WHERE n.id = queued.id
       RETURNING n.id, n.recipient_email, n.payload`,
      [batchSize]
    );
    claimed = result.rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let sent = 0;
  let failed = 0;
  for (const notification of claimed) {
    try {
      await sendPublicEnquiryEmail(
        notification.payload,
        notification.recipient_email,
        `public-enquiry-${notification.id}`
      );
      await pool.query(
        `UPDATE public_enquiry_notification_outbox
         SET status = 'SENT', sent_at = now(), updated_at = now(), last_error = NULL
         WHERE id = $1 AND status = 'SENDING'`,
        [notification.id]
      );
      sent += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.slice(0, 200) : "NotificationError";
      await pool.query(
        `UPDATE public_enquiry_notification_outbox
         SET status = 'FAILED',
             last_error = $2,
             next_attempt_at = now() + make_interval(
               secs => LEAST(86400, (60 * power(2, LEAST(attempts, 10)))::int)
             ),
             updated_at = now()
         WHERE id = $1 AND status = 'SENDING'`,
        [notification.id, errorMessage]
      );
      failed += 1;
    }
  }
  return { sent, failed };
}
