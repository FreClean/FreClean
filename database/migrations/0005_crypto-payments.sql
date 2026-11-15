-- Add the new crypto payment model without deleting or rewriting historical records.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS asset TEXT,
  ADD COLUMN IF NOT EXISTS network TEXT,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS receiving_address TEXT,
  ADD COLUMN IF NOT EXISTS transaction_hash TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

UPDATE payments p
SET customer_id = o.customer_id
FROM orders o
WHERE p.order_id = o.id AND p.customer_id IS NULL;

UPDATE payments p
SET customer_id = b.customer_id
FROM bookings b
WHERE p.booking_id = b.id AND p.customer_id IS NULL;

UPDATE payments
SET amount = amount_cents::NUMERIC / 100
WHERE amount IS NULL;

UPDATE payments
SET verified_at = updated_at
WHERE verification_status = 'VERIFIED'
  AND status IN ('VERIFIED','COMPLETED')
  AND verified_at IS NULL;

ALTER TABLE payments ALTER COLUMN amount SET NOT NULL;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('USDT','CELOHT_DAPP','CRYPTO','CARD','CASH'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN (
    'PENDING','VERIFYING','PAID','FAILED','EXPIRED','CANCELLED','REFUNDED',
    'CREATED','PROCESSING','VERIFIED','COMPLETED','REJECTED'
  ));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_asset_check;
ALTER TABLE payments ADD CONSTRAINT payments_asset_check
  CHECK (asset IS NULL OR asset = 'USDT');

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_network_check;
ALTER TABLE payments ADD CONSTRAINT payments_network_check
  CHECK (network IS NULL OR network IN ('BEP20','TRC20','SOLANA','CELO'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_hash
  ON payments (lower(transaction_hash))
  WHERE transaction_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_customer_created
  ON payments (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order
  ON payments (order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_booking
  ON payments (booking_id)
  WHERE booking_id IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'UNPAID'
  CHECK (payment_status IN ('UNPAID','PENDING','VERIFYING','PAID','FAILED','EXPIRED','CANCELLED','REFUNDED'));
UPDATE orders SET payment_status = 'PAID' WHERE status = 'PAID';
UPDATE orders o
SET status = 'PAID', payment_status = 'PAID', updated_at = now()
WHERE o.status IN ('CHECKOUT','PAYMENT_PENDING')
  AND EXISTS (
    SELECT 1 FROM payments p
    WHERE p.order_id = o.id
      AND p.verification_status = 'VERIFIED'
      AND p.status IN ('VERIFIED','COMPLETED')
  );

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'UNPAID'
  CHECK (payment_status IN ('UNPAID','PENDING','VERIFYING','PAID','FAILED','EXPIRED','CANCELLED','REFUNDED'));
UPDATE bookings b
SET payment_status = 'PAID', updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM payments p
  WHERE p.booking_id = b.id
    AND p.verification_status = 'VERIFIED'
    AND p.status IN ('VERIFIED','COMPLETED')
);

CREATE TABLE IF NOT EXISTS payment_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('CUSTOMER','ADMIN')),
  recipient_email TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_id, recipient_type)
);

CREATE INDEX IF NOT EXISTS idx_payment_notifications_pending
  ON payment_notification_outbox (status, created_at)
  WHERE status IN ('PENDING','FAILED');
