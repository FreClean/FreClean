ALTER TABLE public_enquiries
  ADD COLUMN IF NOT EXISTS property_type TEXT,
  ADD COLUMN IF NOT EXISTS space_size TEXT,
  ADD COLUMN IF NOT EXISTS requested_date DATE,
  ADD COLUMN IF NOT EXISTS requested_time TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

CREATE INDEX IF NOT EXISTS idx_public_enquiries_status_created_new
  ON public_enquiries(status, created_at DESC);
