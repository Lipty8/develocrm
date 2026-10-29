BEGIN;

-- Approved business rule, 29 October 2026: sending, negotiating or approving
-- an unsigned document is not itself a commitment protecting the unit.
-- Preserve every existing signature-evidence test and effective-end check.
-- In particular, a corrupt signed status without evidence stays blocking.
-- No historical cases, reservations, contracts or financial rows are changed.
CREATE OR REPLACE FUNCTION app.contract_blocks_unit_release(p_tenant uuid,p_contract uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT EXISTS(SELECT 1 FROM contracts c WHERE c.tenant_id=p_tenant AND c.id=p_contract
    AND (c.current_status NOT IN ('cancelled','terminated') OR c.ended_at IS NULL OR c.ended_at>now())
    AND NOT (c.current_status IN ('draft','sent','negotiation','approved') AND c.signed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM contract_versions v WHERE v.tenant_id=c.tenant_id AND v.contract_id=c.id AND (v.signed_at IS NOT NULL OR v.version_status='signed'))
      AND NOT EXISTS(SELECT 1 FROM contract_parties p WHERE p.tenant_id=c.tenant_id AND p.contract_id=c.id AND p.signature_status='signed')))
$$;

-- The existing assessment, unit-first locks, ownership/independent-hold
-- safeguards, closure guards, audit/outbox and idempotency reuse this helper.
COMMIT;
