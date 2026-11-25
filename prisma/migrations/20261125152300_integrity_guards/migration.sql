-- Integrity guards enforced by the database itself, independent of application code.

-- 1. Audit log is append-only.
CREATE OR REPLACE FUNCTION ecms_block_modify() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not permitted (append-only table)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION ecms_block_modify();

-- 2. Contract value ledger is append-only.
CREATE TRIGGER contract_value_change_append_only
  BEFORE UPDATE OR DELETE ON "ContractValueChange"
  FOR EACH ROW EXECUTE FUNCTION ecms_block_modify();

-- 3. The original contract value can never be changed, and the current value
--    must always equal original + sum of ledger entries.
CREATE OR REPLACE FUNCTION ecms_contract_guard() RETURNS trigger AS $$
DECLARE
  ledger NUMERIC(14,2);
BEGIN
  IF NEW."originalValue" IS DISTINCT FROM OLD."originalValue" THEN
    RAISE EXCEPTION 'The original contract value is locked and cannot be changed';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO ledger FROM "ContractValueChange" WHERE "contractId" = NEW.id;
  IF NEW."currentValue" <> NEW."originalValue" + ledger THEN
    RAISE EXCEPTION 'Contract value can only change through an approved change order (expected %, got %)',
      NEW."originalValue" + ledger, NEW."currentValue";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_value_guard
  BEFORE UPDATE ON "Contract"
  FOR EACH ROW EXECUTE FUNCTION ecms_contract_guard();

-- 4. Approved document versions cannot be modified (other than being marked superseded) or deleted.
CREATE OR REPLACE FUNCTION ecms_docversion_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Document versions cannot be deleted';
  END IF;
  IF OLD."storageKey" <> NEW."storageKey" OR OLD."sha256" <> NEW."sha256" OR OLD.revision <> NEW.revision THEN
    RAISE EXCEPTION 'A stored document version cannot be overwritten; upload a new revision instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_version_guard
  BEFORE UPDATE OR DELETE ON "DocumentVersion"
  FOR EACH ROW EXECUTE FUNCTION ecms_docversion_guard();

-- 5. Money sanity checks.
ALTER TABLE "Payment" ADD CONSTRAINT payment_amount_positive CHECK (amount > 0);
ALTER TABLE "SupplierPayment" ADD CONSTRAINT supplier_payment_amount_positive CHECK (amount > 0);
ALTER TABLE "TimeEntry" ADD CONSTRAINT time_entry_hours_valid CHECK ("regularHours" >= 0 AND "overtimeHours" >= 0 AND "regularHours" + "overtimeHours" <= 24);
ALTER TABLE "Contract" ADD CONSTRAINT contract_original_nonneg CHECK ("originalValue" >= 0);
