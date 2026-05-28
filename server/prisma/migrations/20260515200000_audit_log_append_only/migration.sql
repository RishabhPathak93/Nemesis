-- NEM-2026-016: enforce append-only semantics on AuditLog at the DB layer.
--
-- The application writes audit rows correctly today, but a compromised
-- application role (or an operator who runs raw SQL) can in principle UPDATE
-- or DELETE rows to scrub a trail. Belt-and-braces: reject any UPDATE/DELETE
-- on "AuditLog" unless the SESSION sets the GUC `cortexview.audit_modify` to
-- 'on'.
--
-- Two legitimate write paths set the GUC:
--   1. retentionQueue.ts — deletes rows past retention window
--   2. dsrController.ts  — nulls actorId for GDPR data-subject erasure
--
-- Anyone else (including a SQL injection that somehow reaches AuditLog UPDATE)
-- raises an exception.

CREATE OR REPLACE FUNCTION cortexview_block_audit_modify()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('cortexview.audit_modify', true), 'off') <> 'on' THEN
    RAISE EXCEPTION
      'audit log is append-only; set cortexview.audit_modify=on for legitimate retention/DSR paths'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_log_block_update ON "AuditLog";
CREATE TRIGGER audit_log_block_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION cortexview_block_audit_modify();

DROP TRIGGER IF EXISTS audit_log_block_delete ON "AuditLog";
CREATE TRIGGER audit_log_block_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION cortexview_block_audit_modify();
