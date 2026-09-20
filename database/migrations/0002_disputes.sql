-- First-class dispute cases. Evidence remains private metadata until a storage provider is configured.
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), public_reference TEXT NOT NULL UNIQUE, customer_id UUID NOT NULL REFERENCES users(id),
  order_id UUID REFERENCES orders(id), order_item_id UUID REFERENCES order_items(id), payment_id UUID REFERENCES payments(id), refund_id UUID, return_id UUID,
  booking_id UUID REFERENCES bookings(id), product_id UUID REFERENCES products(id), category TEXT NOT NULL, reason TEXT, description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','WAITING_FOR_INFORMATION','RESOLUTION_PROPOSED','RESOLVED','CLOSED','ESCALATED','EXTERNAL_REVIEW_REQUIRED','EXTERNAL_ACTION_REQUIRED','CANCELLED','DUPLICATE','REJECTED')),
  country TEXT, currency TEXT NOT NULL DEFAULT 'USD', assigned_to UUID REFERENCES users(id), resolution_type TEXT, resolution_description TEXT, internal_notes TEXT,
  customer_visible_notes TEXT, escalation_status TEXT, external_reference TEXT, acknowledged_at TIMESTAMPTZ, investigation_at TIMESTAMPTZ, resolution_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_disputes_customer_created ON disputes(customer_id, created_at DESC);
CREATE INDEX idx_disputes_queue ON disputes(status, priority, created_at);
CREATE INDEX idx_disputes_assignee ON disputes(assigned_to, status);
CREATE TABLE dispute_status_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE, from_status TEXT, to_status TEXT NOT NULL, changed_by UUID REFERENCES users(id), note TEXT, changed_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE dispute_messages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE, sender_id UUID NOT NULL REFERENCES users(id), visibility TEXT NOT NULL CHECK (visibility IN ('CUSTOMER','INTERNAL')), message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 10000), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_dispute_messages_timeline ON dispute_messages(dispute_id, created_at);
CREATE TABLE dispute_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id), storage_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL,
  content_type TEXT NOT NULL, size_bytes BIGINT NOT NULL CHECK (size_bytes > 0), sha256 TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (scan_status IN ('PENDING','CLEAN','REJECTED')),
  retention_until TIMESTAMPTZ, deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispute_evidence_case ON dispute_evidence(dispute_id, created_at);