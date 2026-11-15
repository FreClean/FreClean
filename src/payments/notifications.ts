import { pool } from "../db.js";
import { sendPaymentNotification, type PaymentNotification } from "./email.js";
import { notificationStageError, safeNotificationErrorRecord } from "../notifications/resend.js";

interface OutboxRow {
  id: string;
  recipient_email: string;
  payload: PaymentNotification;
}

export async function deliverPendingPaymentNotifications(batchSize = 10) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw notificationStageError("outbox_connect", error);
  }
  let claimed: OutboxRow[];
  try {
    await client.query("BEGIN");
    const result = await client.query<OutboxRow>(
      `WITH exhausted AS (
         UPDATE payment_notification_outbox
         SET status = 'FAILED', last_error = COALESCE(last_error, 'RETRY_LIMIT_EXCEEDED'), updated_at = now()
         WHERE status = 'SENDING' AND updated_at < now() - INTERVAL '5 minutes' AND attempts >= 5
       ), queued AS (
         SELECT id
         FROM payment_notification_outbox
         WHERE attempts < 5
           AND ((status = 'PENDING' AND next_attempt_at <= now())
                OR (status = 'FAILED' AND next_attempt_at <= now())
                OR (status = 'SENDING' AND updated_at < now() - INTERVAL '5 minutes'))
         ORDER BY next_attempt_at, created_at
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
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw notificationStageError("outbox_rollback", rollbackError);
    }
    throw notificationStageError("outbox_claim", error);
  } finally {
    client.release();
  }

  let sent = 0;
  let failed = 0;
  const failureCodes = new Set<string>();
  for (const notification of claimed) {
    try {
      await sendPaymentNotification(notification.payload, notification.recipient_email);
    } catch (error) {
      const errorCode = safeNotificationErrorRecord(error);
      try {
        await pool.query(
          `UPDATE payment_notification_outbox
           SET status = 'FAILED',
               last_error = $2,
               next_attempt_at = now() + make_interval(
                 secs => LEAST(86400, (60 * power(2, LEAST(attempts, 10)))::int)
               ),
               updated_at = now()
           WHERE id = $1 AND status = 'SENDING'`,
          [notification.id, errorCode]
        );
        failed += 1;
        failureCodes.add(errorCode);
      } catch (persistenceError) {
        throw notificationStageError("outbox_status", persistenceError);
      }
      continue;
    }

    try {
      const updated = await pool.query(
        `UPDATE payment_notification_outbox
         SET status = 'SENT', sent_at = now(), updated_at = now(), last_error = NULL
         WHERE id = $1 AND status = 'SENDING'`,
        [notification.id]
      );
      if (updated.rowCount !== 1) throw new Error("Notification success status was not recorded");
      sent += 1;
    } catch (error) {
      throw notificationStageError("outbox_status", error);
    }
  }
  return { sent, failed, failureCodes: [...failureCodes] };
}
