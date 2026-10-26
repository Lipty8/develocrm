BEGIN;

-- Approved RS/SBK use the apartment number, never digits from a contract
-- reference. Replace only the audited calculation; do not backfill snapshots,
-- obligations, generated documents or historical contracts.
DO $$
DECLARE definition text;
  old_symbol text := $old$symbol:=regexp_replace(c.reference,'\D','','g');
  IF NULLIF(symbol,'') IS NULL THEN RAISE EXCEPTION 'PAYMENT_TERMS_REFERENCE_REQUIRED'; END IF;$old$;
  new_symbol text := $new$SELECT code INTO symbol FROM units
    WHERE tenant_id=p_tenant AND project_id=c.project_id AND id=c.unit_id;
  IF symbol IS NULL OR symbol !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PAYMENT_TERMS_UNIT_CODE_REQUIRED';
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('app.prepare_signature_payment_terms(uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF position(old_symbol IN definition)=0 THEN RAISE EXCEPTION 'Unexpected payment variable symbol calculation'; END IF;
  EXECUTE replace(definition,old_symbol,new_symbol);
END $$;

-- An explicit NEW business version must not inherit a known-obsolete symbol.
-- It starts without payment terms and requires the existing preparation
-- command. Previously generated/signed versions remain untouched. Matching
-- plans keep the existing inheritance behavior, including leading zeroes.
DO $$
DECLARE definition text;
  old_inheritance text := 'IF NEW.payment_terms_snapshot IS NULL THEN NEW.payment_terms_snapshot:=previous; END IF;';
  new_inheritance text := $new$IF NEW.payment_terms_snapshot IS NULL AND previous->>'variableSymbol'=(
      SELECT u.code FROM contracts c JOIN units u ON u.tenant_id=c.tenant_id AND u.project_id=c.project_id AND u.id=c.unit_id
      WHERE c.tenant_id=NEW.tenant_id AND c.project_id=NEW.project_id AND c.id=NEW.contract_id
    ) THEN NEW.payment_terms_snapshot:=previous; END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('app.guard_contract_payment_terms()'::regprocedure) INTO definition;
  IF position(old_inheritance IN definition)=0 THEN RAISE EXCEPTION 'Unexpected payment terms inheritance'; END IF;
  EXECUTE replace(definition,old_inheritance,new_inheritance);
END $$;

COMMIT;
