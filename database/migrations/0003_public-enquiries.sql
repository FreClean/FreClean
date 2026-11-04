CREATE TABLE public_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_type TEXT NOT NULL CHECK (enquiry_type IN ('SERVICE','CONTACT')),
  full_name TEXT NOT NULL CHECK (length(full_name) BETWEEN 2 AND 100),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 32),
  service TEXT CHECK (service IS NULL OR length(service) <= 100),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 10 AND 5000),
  spam_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','CONTACTED','CLOSED','SPAM')),
  source_origin TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_public_enquiries_created ON public_enquiries(created_at DESC);
CREATE INDEX idx_public_enquiries_status_created ON public_enquiries(status, created_at DESC);
CREATE INDEX idx_public_enquiries_recent_spam_hash
  ON public_enquiries(spam_hash, created_at DESC);
