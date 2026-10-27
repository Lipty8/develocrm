-- No backfill: historical hashes do not uniquely reveal the original request.
-- Preserve JSON byte/key order: the existing request hash uses JSON.stringify.
ALTER TABLE document_generation_operations ADD COLUMN request_context text
  CHECK(request_context IS NULL OR jsonb_typeof(request_context::jsonb)='object');
CREATE FUNCTION app.protect_generation_request_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.request_context IS DISTINCT FROM NEW.request_context THEN
    RAISE EXCEPTION 'immutable document generation request';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_generation_request_immutable BEFORE UPDATE ON document_generation_operations
  FOR EACH ROW EXECUTE FUNCTION app.protect_generation_request_context();
