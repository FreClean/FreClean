CREATE TABLE IF NOT EXISTS public_enquiry_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id UUID NOT NULL REFERENCES public_enquiries(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL CHECK (length(recipient_email) BETWEEN 3 AND 254),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enquiry_id)
);

CREATE INDEX IF NOT EXISTS idx_public_enquiry_notifications_pending
  ON public_enquiry_notification_outbox (status, next_attempt_at, created_at)
  WHERE status IN ('PENDING','FAILED');
