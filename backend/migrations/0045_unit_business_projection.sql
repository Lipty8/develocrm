BEGIN;

-- One read model for the current buyer and the commercial KPI state of a unit.
-- Historical or cancelled cases never influence the current projection.
CREATE OR REPLACE FUNCTION app.unit_business_projection(p_tenant uuid,p_unit uuid)
RETURNS TABLE(
  sales_case_id uuid,
  current_stage text,
  sales_bucket text,
  effective_status text,
  current_buyers jsonb,
  has_signed_rs boolean,
  rs_fee_fully_paid boolean,
  has_signed_sbk boolean,
  has_signed_ks boolean,
  handover_completed boolean
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH active_case AS (
    SELECT sales_case.id,sales_case.current_stage
    FROM sales_cases sales_case
    WHERE sales_case.tenant_id=p_tenant AND sales_case.unit_id=p_unit AND sales_case.status='active'
    ORDER BY sales_case.opened_at DESC,sales_case.id DESC
    LIMIT 1
  ), contract_state AS (
    SELECT
      COALESCE(bool_or(contract.contract_type='rs' AND contract.current_status='signed'),false) has_signed_rs,
      COALESCE(bool_or(contract.contract_type='sbk' AND contract.current_status='signed'),false) has_signed_sbk,
      COALESCE(bool_or(contract.contract_type='ks' AND contract.current_status='signed'),false) has_signed_ks
    FROM active_case
    LEFT JOIN contracts contract ON contract.tenant_id=p_tenant AND contract.sales_case_id=active_case.id
      AND contract.contract_type IN ('rs','sbk','ks') AND contract.current_status NOT IN ('cancelled','terminated')
  ), payment_state AS (
    SELECT EXISTS(
      SELECT 1 FROM active_case
      JOIN contracts contract ON contract.tenant_id=p_tenant AND contract.sales_case_id=active_case.id
        AND contract.contract_type='rs' AND contract.current_status='signed'
      JOIN payment_obligations obligation ON obligation.tenant_id=contract.tenant_id AND obligation.contract_id=contract.id
        AND obligation.obligation_type='reservation_fee' AND obligation.cancelled_at IS NULL
      WHERE app.payment_obligation_paid(obligation.tenant_id,obligation.id)>=obligation.amount
    ) rs_fee_fully_paid
  ), handover_state AS (
    SELECT EXISTS(
      SELECT 1 FROM active_case
      JOIN unit_handovers handover ON handover.tenant_id=p_tenant AND handover.unit_id=p_unit
        AND handover.sales_case_id=active_case.id AND handover.status='handed_over'
    ) handover_completed
  ), buyers AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'partyId',participant.party_id,
      'name',party.display_name,
      'role',participant.participant_role,
      'isPrimary',participant.is_primary,
      'share',participant.ownership_share
    ) ORDER BY participant.is_primary DESC,participant.joined_at,participant.id),'[]'::jsonb) current_buyers
    FROM active_case
    JOIN sales_case_parties participant ON participant.tenant_id=p_tenant AND participant.sales_case_id=active_case.id
      AND participant.participant_role IN ('buyer','co_buyer') AND participant.left_at IS NULL
    JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
      AND party.lifecycle_status<>'merged'
  ), projected AS (
    SELECT active_case.id sales_case_id,active_case.current_stage,
      CASE
        WHEN active_case.id IS NULL THEN 'available'
        WHEN handover_state.handover_completed OR contract_state.has_signed_ks OR contract_state.has_signed_sbk
          OR (contract_state.has_signed_rs AND payment_state.rs_fee_fully_paid) THEN 'sold'
        ELSE 'in_negotiation'
      END sales_bucket,
      buyers.current_buyers,contract_state.*,payment_state.rs_fee_fully_paid,handover_state.handover_completed
    FROM (SELECT 1) singleton
    LEFT JOIN active_case ON true
    CROSS JOIN contract_state
    CROSS JOIN payment_state
    CROSS JOIN handover_state
    CROSS JOIN buyers
  )
  SELECT projected.sales_case_id,projected.current_stage,projected.sales_bucket,projected.sales_bucket,
    projected.current_buyers,projected.has_signed_rs,projected.rs_fee_fully_paid,
    projected.has_signed_sbk,projected.has_signed_ks,projected.handover_completed
  FROM projected
$$;

GRANT EXECUTE ON FUNCTION app.unit_business_projection(uuid,uuid) TO develocrm_app;

COMMIT;
