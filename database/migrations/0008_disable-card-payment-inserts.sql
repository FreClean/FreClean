CREATE OR REPLACE FUNCTION reject_new_unsupported_digital_payment_method()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.method IN ('CARD','CRYPTO') THEN
    RAISE EXCEPTION 'This payment method is not supported'
      USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'UPDATE' AND NEW.method IN ('CARD','CRYPTO')
      AND NEW.method IS DISTINCT FROM OLD.method THEN
    RAISE EXCEPTION 'This payment method is not supported'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_reject_unsupported_digital_method
BEFORE INSERT OR UPDATE OF method ON payments
FOR EACH ROW
EXECUTE FUNCTION reject_new_unsupported_digital_payment_method();
