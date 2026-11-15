ALTER TABLE payment_notification_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_payment_notifications_due
  ON payment_notification_outbox (status, next_attempt_at, created_at)
  WHERE status IN ('PENDING','FAILED');
