BEGIN;

-- A contract remains the same legal document while its current buyer can change.
-- Contract parties therefore have their own validity interval and assignment audit.
CREATE TABLE buyer_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  sales_case_id uuid NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_membership_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason))>=3),
  idempotency_key text NOT NULL,
  previous_buyers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(previous_buyers)='array'),
  current_buyers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(current_buyers)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buyer_assignment_case_fk FOREIGN KEY (tenant_id,project_id,sales_case_id)
    REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT buyer_assignment_unit_fk FOREIGN KEY (tenant_id,project_id,unit_id)
    REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT buyer_assignment_actor_fk FOREIGN KEY (tenant_id,recorded_by_membership_id)
    REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT buyer_assignment_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT buyer_assignment_idempotency_uq UNIQUE (tenant_id,sales_case_id,idempotency_key)
);
CREATE INDEX buyer_assignment_history_idx ON buyer_assignment_events(tenant_id,sales_case_id,effective_at DESC,id DESC);

ALTER TABLE contract_parties
  ADD COLUMN effective_from timestamptz,
  ADD COLUMN effective_to timestamptz,
  ADD COLUMN assignment_event_id uuid,
  ADD COLUMN ended_by_assignment_event_id uuid;

ALTER TABLE contract_parties DISABLE TRIGGER contract_parties_guard;
UPDATE contract_parties SET effective_from=created_at WHERE effective_from IS NULL;
ALTER TABLE contract_parties ENABLE TRIGGER contract_parties_guard;
ALTER TABLE contract_parties ALTER COLUMN effective_from SET NOT NULL;
ALTER TABLE contract_parties ALTER COLUMN effective_from SET DEFAULT now();
ALTER TABLE contract_parties ADD CONSTRAINT contract_party_effective_range
  CHECK (effective_to IS NULL OR effective_to>=effective_from);
ALTER TABLE contract_parties ADD CONSTRAINT contract_party_assignment_event_fk
  FOREIGN KEY (tenant_id,assignment_event_id) REFERENCES buyer_assignment_events(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE contract_parties ADD CONSTRAINT contract_party_ended_event_fk
  FOREIGN KEY (tenant_id,ended_by_assignment_event_id) REFERENCES buyer_assignment_events(tenant_id,id) ON DELETE RESTRICT;

ALTER TABLE contract_parties DROP CONSTRAINT contract_party_uq;
CREATE UNIQUE INDEX contract_party_current_uq
  ON contract_parties(tenant_id,contract_id,party_id,participant_role)
  WHERE effective_to IS NULL;
CREATE INDEX contract_party_history_idx
  ON contract_parties(tenant_id,contract_id,effective_from DESC,effective_to);

-- One live core contract of each type is allowed in one sales case. Amendments are
-- independent legal documents and are intentionally excluded.
CREATE UNIQUE INDEX contracts_one_live_core_type_uq
  ON contracts(tenant_id,sales_case_id,contract_type)
  WHERE contract_type IN ('rs','sbk','ks') AND current_status NOT IN ('cancelled','terminated');

CREATE OR REPLACE FUNCTION app.guard_contract_parties() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract_state text;
BEGIN
  SELECT current_status INTO contract_state FROM contracts
  WHERE tenant_id=COALESCE(NEW.tenant_id,OLD.tenant_id) AND id=COALESCE(NEW.contract_id,OLD.contract_id);
  IF contract_state IN ('signed','terminated')
     AND current_setting('app.contract_party_assignment_command',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'participants of a signed contract are immutable';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION app.assign_sales_case_buyers(
  p_tenant uuid,p_case uuid,p_buyers jsonb,p_actor_membership uuid,p_reason text,p_idempotency_key text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  case_row sales_cases%ROWTYPE; actor uuid; event_id uuid; previous_buyers jsonb; current_buyers jsonb;
  reason_text text:=COALESCE(NULLIF(btrim(p_reason),''),'Postoupení smlouvy');
  desired record; contract_row contracts%ROWTYPE; interest_id uuid; desired_count integer; primary_count integer;
BEGIN
  IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'buyer assignment idempotency key is required'; END IF;
  SELECT id INTO event_id FROM buyer_assignment_events
    WHERE tenant_id=p_tenant AND sales_case_id=p_case AND idempotency_key=p_idempotency_key;
  IF event_id IS NOT NULL THEN RETURN event_id; END IF;

  SELECT * INTO case_row FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case FOR UPDATE;
  SELECT id INTO event_id FROM buyer_assignment_events
    WHERE tenant_id=p_tenant AND sales_case_id=p_case AND idempotency_key=p_idempotency_key;
  IF event_id IS NOT NULL THEN RETURN event_id; END IF;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF case_row.id IS NULL OR case_row.status<>'active' THEN RAISE EXCEPTION 'active sales case is required'; END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,case_row.project_id,'sales_case.manage') THEN
    RAISE EXCEPTION 'sales_case.manage permission required';
  END IF;
  IF jsonb_typeof(COALESCE(p_buyers,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'buyers must be an array'; END IF;

  SELECT count(*),count(*) FILTER(WHERE COALESCE(item."isPrimary",false)) INTO desired_count,primary_count
  FROM jsonb_to_recordset(COALESCE(p_buyers,'[]'::jsonb)) AS item("partyId" text,role text,"isPrimary" boolean,share numeric);
  IF desired_count>0 AND primary_count<>1 THEN RAISE EXCEPTION 'exactly one current buyer must be primary'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_to_recordset(COALESCE(p_buyers,'[]'::jsonb)) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)
    WHERE item."partyId" IS NULL OR item.role NOT IN ('buyer','co_buyer') OR (item.share IS NOT NULL AND (item.share<=0 OR item.share>1))
  ) THEN RAISE EXCEPTION 'invalid buyer assignment'; END IF;
  IF (SELECT count(DISTINCT item."partyId") FROM jsonb_to_recordset(COALESCE(p_buyers,'[]'::jsonb)) AS item("partyId" text,role text,"isPrimary" boolean,share numeric))<>desired_count THEN
    RAISE EXCEPTION 'buyers must be unique';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_to_recordset(COALESCE(p_buyers,'[]'::jsonb)) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)
    LEFT JOIN parties party ON party.tenant_id=p_tenant AND party.id=item."partyId"::uuid AND party.lifecycle_status='active' AND party.archived_at IS NULL
    WHERE party.id IS NULL
  ) THEN RAISE EXCEPTION 'all buyers must be active clients of the workspace'; END IF;
  IF COALESCE((SELECT sum(item.share) FROM jsonb_to_recordset(COALESCE(p_buyers,'[]'::jsonb)) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)),0)>1 THEN
    RAISE EXCEPTION 'buyer ownership shares cannot exceed one hundred percent';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('partyId',party_id,'role',participant_role,'isPrimary',is_primary,'share',ownership_share) ORDER BY is_primary DESC,joined_at,id),'[]'::jsonb)
    INTO previous_buyers FROM sales_case_parties
    WHERE tenant_id=p_tenant AND sales_case_id=p_case AND participant_role IN ('buyer','co_buyer') AND left_at IS NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('partyId',item."partyId",'role',item.role,'isPrimary',COALESCE(item."isPrimary",false),'share',item.share) ORDER BY COALESCE(item."isPrimary",false) DESC,item."partyId"),'[]'::jsonb)
    INTO current_buyers FROM jsonb_to_recordset(COALESCE(p_buyers,'[]'::jsonb)) AS item("partyId" text,role text,"isPrimary" boolean,share numeric);

  event_id:=gen_random_uuid();
  INSERT INTO buyer_assignment_events(id,tenant_id,project_id,unit_id,sales_case_id,recorded_by_membership_id,reason,idempotency_key,previous_buyers,current_buyers)
  VALUES(event_id,p_tenant,case_row.project_id,case_row.unit_id,p_case,p_actor_membership,reason_text,btrim(p_idempotency_key),previous_buyers,current_buyers);

  UPDATE sales_case_parties SET left_at=now(),is_primary=false
  WHERE tenant_id=p_tenant AND sales_case_id=p_case AND participant_role IN ('buyer','co_buyer') AND left_at IS NULL;
  FOR desired IN SELECT * FROM jsonb_to_recordset(COALESCE(p_buyers,'[]'::jsonb)) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)
  LOOP
    INSERT INTO sales_case_parties(tenant_id,project_id,sales_case_id,party_id,participant_role,ownership_share,is_primary,joined_at,left_at)
    VALUES(p_tenant,case_row.project_id,p_case,desired."partyId"::uuid,desired.role,desired.share,COALESCE(desired."isPrimary",false),now(),NULL)
    ON CONFLICT ON CONSTRAINT sales_case_party_uq DO UPDATE SET left_at=NULL,joined_at=now(),ownership_share=EXCLUDED.ownership_share,is_primary=EXCLUDED.is_primary;
    INSERT INTO party_project_links(tenant_id,project_id,party_id,relationship_type)
    SELECT p_tenant,case_row.project_id,desired."partyId"::uuid,'buyer'
    WHERE NOT EXISTS(SELECT 1 FROM party_project_links WHERE tenant_id=p_tenant AND project_id=case_row.project_id AND party_id=desired."partyId"::uuid AND relationship_type='buyer' AND valid_to IS NULL);
    INSERT INTO unit_interests(tenant_id,project_id,unit_id,party_id,status,first_interest_at,last_interest_at)
    VALUES(p_tenant,case_row.project_id,case_row.unit_id,desired."partyId"::uuid,'converted',now(),now())
    ON CONFLICT(tenant_id,unit_id,party_id) DO UPDATE SET status='converted',last_interest_at=EXCLUDED.last_interest_at
    RETURNING id INTO interest_id;
    INSERT INTO interest_events(tenant_id,project_id,unit_interest_id,sales_case_id,event_type,outcome,note,occurred_at,recorded_by_membership_id)
    VALUES(p_tenant,case_row.project_id,interest_id,p_case,'converted_to_sales_case','Postoupení smlouvy',reason_text,now(),p_actor_membership);
  END LOOP;

  PERFORM set_config('app.contract_party_assignment_command','on',true);
  FOR contract_row IN SELECT * FROM contracts WHERE tenant_id=p_tenant AND sales_case_id=p_case AND current_status NOT IN ('cancelled','terminated') FOR UPDATE
  LOOP
    UPDATE contract_parties SET effective_to=now(),ended_by_assignment_event_id=event_id,
      signing_required=CASE WHEN signature_status='signed' THEN signing_required ELSE false END,
      signature_status=CASE WHEN signature_status='signed' THEN signature_status ELSE 'not_required' END,
      signed_at=CASE WHEN signature_status='signed' THEN signed_at ELSE NULL END,
      signed_version_id=CASE WHEN signature_status='signed' THEN signed_version_id ELSE NULL END
    WHERE tenant_id=p_tenant AND contract_id=contract_row.id AND participant_role IN ('buyer','co_buyer') AND effective_to IS NULL;
    FOR desired IN SELECT * FROM jsonb_to_recordset(COALESCE(p_buyers,'[]'::jsonb)) AS item("partyId" text,role text,"isPrimary" boolean,share numeric)
    LOOP
      INSERT INTO contract_parties(tenant_id,project_id,contract_id,party_id,participant_role,signing_required,signature_status,effective_from,assignment_event_id)
      VALUES(p_tenant,case_row.project_id,contract_row.id,desired."partyId"::uuid,desired.role,
        contract_row.current_status<>'signed',CASE WHEN contract_row.current_status='signed' THEN 'not_required' ELSE 'pending' END,now(),event_id);
    END LOOP;
  END LOOP;
  PERFORM set_config('app.contract_party_assignment_command','off',true);

  INSERT INTO audit_log(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
  VALUES(event_id,p_tenant,actor,'buyer_assignment.transferred','sales_case',p_case,
    jsonb_build_object('buyers',previous_buyers),jsonb_build_object('buyers',current_buyers),
    jsonb_build_object('projectId',case_row.project_id,'unitId',case_row.unit_id,'reason',reason_text));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'sales_case',p_case,'buyer_assignment.transferred.v1',jsonb_build_object(
    'assignmentEventId',event_id,'salesCaseId',p_case,'unitId',case_row.unit_id,'previousBuyers',previous_buyers,'currentBuyers',current_buyers,
    'contractIds',(SELECT COALESCE(jsonb_agg(id),'[]'::jsonb) FROM contracts WHERE tenant_id=p_tenant AND sales_case_id=p_case AND current_status NOT IN ('cancelled','terminated'))));
  RETURN event_id;
END $$;

-- Compatibility wrapper for older callers. New API callers always provide their
-- own idempotency key and can pass multiple current buyers.
CREATE OR REPLACE FUNCTION app.change_sales_case_buyer(
  p_tenant uuid,p_case uuid,p_new_party uuid,p_actor_membership uuid,p_reason text
) RETURNS uuid LANGUAGE sql AS $$
  SELECT app.assign_sales_case_buyers(
    p_tenant,p_case,
    CASE WHEN p_new_party IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('partyId',p_new_party,'role','buyer','isPrimary',true,'share',NULL)) END,
    p_actor_membership,p_reason,'legacy-'||gen_random_uuid()::text
  )
$$;

ALTER TABLE buyer_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_assignment_events FORCE ROW LEVEL SECURITY;
CREATE POLICY buyer_assignment_events_tenant_policy ON buyer_assignment_events
  USING (tenant_id=app.current_tenant_id()) WITH CHECK (tenant_id=app.current_tenant_id());

GRANT SELECT,INSERT ON buyer_assignment_events TO develocrm_app;
GRANT SELECT,INSERT,UPDATE ON contract_parties TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.assign_sales_case_buyers(uuid,uuid,jsonb,uuid,text,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.change_sales_case_buyer(uuid,uuid,uuid,uuid,text) TO develocrm_app;

COMMIT;
