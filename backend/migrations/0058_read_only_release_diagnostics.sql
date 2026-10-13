BEGIN;
-- Deployment metadata only, not business rows. Operator endpoint still requires
-- system.manage + complete project coverage. No automatic repair/backfill.
-- Same metadata table as the migration runner; also allows standalone test fixtures.
CREATE TABLE IF NOT EXISTS schema_migrations(
  filename text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON schema_migrations TO develocrm_app;
-- Preserve old hash bytes. Their serializer order cannot be reconstructed from JSONB.
ALTER TABLE document_generation_operations ADD COLUMN snapshot_hash_scheme text NOT NULL DEFAULT 'legacy-json'
  CHECK(snapshot_hash_scheme IN('legacy-json','canonical-json-v1'));
CREATE FUNCTION app.guard_generation_hash_scheme() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot_hash_scheme IS DISTINCT FROM OLD.snapshot_hash_scheme THEN
    RAISE EXCEPTION 'immutable generation hash scheme';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_generation_hash_scheme_immutable BEFORE UPDATE ON document_generation_operations
 FOR EACH ROW EXECUTE FUNCTION app.guard_generation_hash_scheme();
COMMIT;
