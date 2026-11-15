import { pool } from "../db.js";
import { sendPaymentNotification, type PaymentNotification } from "./email.js";

interface OutboxRow {
  id: string;
  recipient_email: string;
  payload: PaymentNotification;
}

export async function deliverPendingPaymentNotifications(batchSize = 10) {
  const client = await pool.connect();
  let claimed: OutboxRow[];
  try {
    await client.query("BEGIN");
    const result = await client.query<OutboxRow>(
      `WITH queued AS (
         SELECT id
         FROM payment_notification_outbox
         WHERE (status IN ('PENDING','FAILED')
                OR (status = 'SENDING' AND updated_at < now() - INTERVAL '5 minutes'))
           AND attempts < 5
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE payment_notification_outbox n
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
      await sendPaymentNotification(notification.payload, notification.recipient_email);
      await pool.query(
        `UPDATE payment_notification_outbox
         SET status = 'SENT', sent_at = now(), updated_at = now(), last_error = NULL
         WHERE id = $1 AND status = 'SENDING'`,
        [notification.id]
      );
      sent += 1;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "NotificationError";
      await pool.query(
        `UPDATE payment_notification_outbox
         SET status = 'FAILED', last_error = $2, updated_at = now()
         WHERE id = $1 AND status = 'SENDING'`,
        [notification.id, errorName]
      );
      failed += 1;
    }
  }
  return { sent, failed };
}
