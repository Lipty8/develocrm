BEGIN;

-- Only ordinary PDF documents gain the larger limit. No template, signature,
-- authorization, reservation, or immutable evidence rules are replaced.
ALTER TABLE document_upload_operations DROP CONSTRAINT document_upload_operations_file_size_check;
ALTER TABLE document_upload_operations ADD CONSTRAINT document_upload_operations_file_size_check
  CHECK (file_size BETWEEN 1 AND CASE
    WHEN mime_type='application/pdf' AND lower(original_file_name) LIKE '%.pdf' THEN 26214400
    ELSE 4194304 END);

DO $$
DECLARE definition text; old_guard text := 'IF p_file_size<1 OR p_file_size>4194304 THEN RAISE EXCEPTION ''invalid upload size''; END IF;';
BEGIN
  SELECT pg_get_functiondef('app.reserve_document_upload(uuid,uuid,text,text,text,uuid,text,text,text,text,bigint,text,text,text,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure)
    INTO definition;
  IF position(old_guard IN definition)=0 THEN RAISE EXCEPTION 'Unexpected document upload size guard'; END IF;
  EXECUTE replace(definition,old_guard,
    'IF p_file_size IS NULL OR p_file_size<1 OR p_file_size>(CASE WHEN p_mime_type=''application/pdf'' AND lower(p_original_file_name) LIKE ''%.pdf'' THEN 26214400 ELSE 4194304 END) THEN RAISE EXCEPTION ''invalid upload size''; END IF;');
END $$;

COMMIT;
