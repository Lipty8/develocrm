BEGIN;

-- Dodatky jsou samostatné právní dokumenty navázané na podepsanou základní
-- smlouvu. Jejich číslování je nezávislé na logických verzích dokumentu.
ALTER TABLE contracts ADD COLUMN amendment_number integer;
ALTER TABLE contracts ADD COLUMN base_contract_type text;

WITH numbered AS (
  SELECT amendment.id,
    row_number() OVER (PARTITION BY amendment.tenant_id,amendment.parent_contract_id ORDER BY amendment.created_at,amendment.id)::integer amendment_number,
    base.contract_type base_contract_type
  FROM contracts amendment
  LEFT JOIN contracts base ON base.tenant_id=amendment.tenant_id AND base.id=amendment.parent_contract_id
  WHERE amendment.contract_type='amendment'
)
UPDATE contracts contract SET amendment_number=numbered.amendment_number,base_contract_type=numbered.base_contract_type
FROM numbered WHERE contract.id=numbered.id;

ALTER TABLE contracts ADD CONSTRAINT contracts_amendment_number_check CHECK (amendment_number IS NULL OR amendment_number>0);
ALTER TABLE contracts ADD CONSTRAINT contracts_amendment_base_type_check CHECK (base_contract_type IS NULL OR base_contract_type IN ('rs','sbk','ks'));
ALTER TABLE contracts ADD CONSTRAINT contracts_amendment_shape CHECK (
  (contract_type='amendment' AND parent_contract_id IS NOT NULL AND amendment_number IS NOT NULL AND base_contract_type IS NOT NULL)
  OR (contract_type<>'amendment' AND amendment_number IS NULL AND base_contract_type IS NULL)
) NOT VALID;
ALTER TABLE contracts VALIDATE CONSTRAINT contracts_amendment_shape;
CREATE UNIQUE INDEX contracts_amendment_number_uq
  ON contracts(tenant_id,parent_contract_id,amendment_number) WHERE contract_type='amendment';

CREATE TABLE contract_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by_user_id uuid,
  archive_reason text,
  CONSTRAINT contract_notes_contract_fk FOREIGN KEY (tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT contract_notes_author_fk FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT contract_notes_archiver_fk FOREIGN KEY (archived_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT contract_notes_archive_shape CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL AND archive_reason IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL AND length(btrim(archive_reason))>=3)
  ),
  CONSTRAINT contract_notes_tenant_pair_uq UNIQUE (tenant_id,id)
);
CREATE INDEX contract_notes_history_idx ON contract_notes(tenant_id,contract_id,created_at DESC,id DESC);

CREATE TABLE payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  source_transaction_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount>0),
  refunded_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason))>=3),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key))>=8),
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_refunds_obligation_fk FOREIGN KEY (tenant_id,obligation_id) REFERENCES payment_obligations(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_refunds_transaction_fk FOREIGN KEY (tenant_id,source_transaction_id) REFERENCES payment_transactions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_refunds_actor_fk FOREIGN KEY (tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_refunds_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT payment_refunds_idempotency_uq UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX payment_refunds_obligation_idx ON payment_refunds(tenant_id,obligation_id,refunded_at DESC,id DESC);

CREATE OR REPLACE FUNCTION app.create_contract_addendum(
  p_tenant uuid,p_base_contract uuid,p_title text,p_actor_membership uuid,p_idempotency_key text
) RETURNS TABLE(contract_id uuid,version_id uuid,amendment_number integer,reference text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE base contracts%ROWTYPE;actor uuid;created_contract uuid;created_version uuid;next_number integer;reference_text text;title_text text;
BEGIN
  IF NULLIF(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'addendum idempotency key is required';END IF;
  SELECT existing.id,version.id,existing.amendment_number,existing.reference
    INTO created_contract,created_version,next_number,reference_text
  FROM contracts existing
  JOIN contract_versions version ON version.tenant_id=existing.tenant_id AND version.contract_id=existing.id AND version.version_number=1
  WHERE existing.tenant_id=p_tenant AND existing.idempotency_key=p_idempotency_key AND existing.contract_type='amendment';
  IF created_contract IS NOT NULL THEN RETURN QUERY SELECT created_contract,created_version,next_number,reference_text;RETURN;END IF;
  SELECT * INTO base FROM contracts WHERE tenant_id=p_tenant AND id=p_base_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF base.id IS NULL OR base.contract_type NOT IN ('rs','sbk','ks') OR base.current_status<>'signed' THEN RAISE EXCEPTION 'signed base contract is required for addendum';END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,base.project_id,'contract.manage') THEN RAISE EXCEPTION 'contract.manage permission required';END IF;
  SELECT COALESCE(max(existing.amendment_number),0)+1 INTO next_number FROM contracts existing
    WHERE existing.tenant_id=p_tenant AND existing.parent_contract_id=base.id AND existing.contract_type='amendment';
  reference_text:=base.reference||'-D'||lpad(next_number::text,2,'0');
  title_text:=COALESCE(NULLIF(btrim(p_title),''),'Dodatek č. '||next_number||' k '||base.title);
  INSERT INTO contracts(tenant_id,project_id,unit_id,sales_case_id,contract_type,parent_contract_id,reference,title,current_status,
    created_by_membership_id,idempotency_key,amendment_number,base_contract_type)
  VALUES(p_tenant,base.project_id,base.unit_id,base.sales_case_id,'amendment',base.id,reference_text,title_text,'draft',
    p_actor_membership,btrim(p_idempotency_key),next_number,base.contract_type)
  RETURNING id INTO created_contract;
  INSERT INTO contract_versions(tenant_id,project_id,contract_id,version_number,source_type,display_name,generation_payload,created_by_membership_id)
  VALUES(p_tenant,base.project_id,created_contract,1,'manual',reference_text||'_v01',jsonb_build_object('source','contract_addendum','baseContractId',base.id,'baseContractType',base.contract_type,'amendmentNumber',next_number),p_actor_membership)
  RETURNING id INTO created_version;
  INSERT INTO contract_parties(tenant_id,project_id,contract_id,party_id,participant_role,signing_required,signature_status,effective_from,is_primary_buyer,ownership_share)
  SELECT p_tenant,base.project_id,created_contract,party.party_id,party.participant_role,party.signing_required,
    CASE WHEN party.signing_required THEN 'pending' ELSE 'not_required' END,now(),party.is_primary_buyer,party.ownership_share
  FROM contract_parties party
  WHERE party.tenant_id=p_tenant AND party.contract_id=base.id AND party.effective_to IS NULL;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
  VALUES(p_tenant,base.project_id,created_contract,NULL,'draft','createAddendum','Dodatek vytvořen k podepsané základní smlouvě',p_actor_membership,'manual');
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.addendum_created','contract',created_contract,jsonb_build_object('reference',reference_text,'amendmentNumber',next_number),jsonb_build_object('projectId',base.project_id,'baseContractId',base.id,'baseContractType',base.contract_type));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',created_contract,'contract.addendum_created.v1',jsonb_build_object('contractId',created_contract,'baseContractId',base.id,'amendmentNumber',next_number,'reference',reference_text));
  RETURN QUERY SELECT created_contract,created_version,next_number,reference_text;
END $$;

CREATE OR REPLACE FUNCTION app.add_contract_note(p_tenant uuid,p_contract uuid,p_text text,p_actor_membership uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE contract_row contracts%ROWTYPE;actor uuid;note_id uuid:=gen_random_uuid();
BEGIN
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF contract_row.id IS NULL OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.manage') THEN RAISE EXCEPTION 'contract.manage permission required';END IF;
  IF NULLIF(btrim(p_text),'') IS NULL THEN RAISE EXCEPTION 'contract note text is required';END IF;
  INSERT INTO contract_notes(id,tenant_id,project_id,contract_id,author_user_id,text) VALUES(note_id,p_tenant,contract_row.project_id,p_contract,actor,btrim(p_text));
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata) VALUES(p_tenant,actor,'contract.note_added','contract_note',note_id,jsonb_build_object('contractId',p_contract),jsonb_build_object('projectId',contract_row.project_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'contract',p_contract,'contract.note_added.v1',jsonb_build_object('contractId',p_contract,'noteId',note_id));
  RETURN note_id;
END $$;

CREATE OR REPLACE FUNCTION app.archive_contract_note(p_tenant uuid,p_note uuid,p_reason text,p_actor_membership uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE note_row contract_notes%ROWTYPE;actor uuid;
BEGIN
  SELECT * INTO note_row FROM contract_notes WHERE tenant_id=p_tenant AND id=p_note FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF note_row.id IS NULL OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,note_row.project_id,'contract.manage') THEN RAISE EXCEPTION 'contract.manage permission required';END IF;
  IF note_row.archived_at IS NOT NULL THEN RETURN note_row.id;END IF;
  IF length(btrim(COALESCE(p_reason,'')))<3 THEN RAISE EXCEPTION 'archive reason is required';END IF;
  UPDATE contract_notes SET archived_at=now(),archived_by_user_id=actor,archive_reason=btrim(p_reason) WHERE tenant_id=p_tenant AND id=p_note;
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata) VALUES(p_tenant,actor,'contract.note_archived','contract_note',p_note,jsonb_build_object('archived',false),jsonb_build_object('archived',true),jsonb_build_object('projectId',note_row.project_id,'contractId',note_row.contract_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'contract',note_row.contract_id,'contract.note_archived.v1',jsonb_build_object('contractId',note_row.contract_id,'noteId',p_note));
  RETURN p_note;
END $$;

CREATE OR REPLACE FUNCTION app.create_payment_refund(
  p_tenant uuid,p_obligation uuid,p_source_transaction uuid,p_amount numeric,p_refunded_at timestamptz,
  p_reason text,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,app AS $$
DECLARE obligation payment_obligations%ROWTYPE;source_allocation numeric;already_refunded numeric;actor uuid;refund_id uuid;
BEGIN
  SELECT id INTO refund_id FROM payment_refunds WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF refund_id IS NOT NULL THEN RETURN refund_id;END IF;
  SELECT * INTO obligation FROM payment_obligations WHERE tenant_id=p_tenant AND id=p_obligation FOR UPDATE;
  SELECT allocation.amount INTO source_allocation FROM payment_allocations allocation
    LEFT JOIN payment_reversals reversal ON reversal.tenant_id=allocation.tenant_id AND reversal.transaction_id=allocation.transaction_id
    WHERE allocation.tenant_id=p_tenant AND allocation.obligation_id=p_obligation AND allocation.transaction_id=p_source_transaction AND reversal.id IS NULL;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF obligation.id IS NULL OR source_allocation IS NULL THEN RAISE EXCEPTION 'received payment allocation is required for refund';END IF;
  IF NOT EXISTS(SELECT 1 FROM contracts contract WHERE contract.tenant_id=p_tenant AND contract.id=obligation.contract_id AND contract.contract_type='rs' AND contract.current_status IN ('cancelled','terminated')) THEN RAISE EXCEPTION 'refund is allowed only for a cancelled RS';END IF;
  IF actor IS NULL OR NOT (app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.reverse') OR app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.manage')) THEN RAISE EXCEPTION 'payments.reverse permission required';END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_refunded_at IS NULL OR length(btrim(COALESCE(p_reason,'')))<3 OR length(btrim(COALESCE(p_idempotency_key,'')))<8 THEN RAISE EXCEPTION 'valid refund amount, date, reason and idempotency key are required';END IF;
  SELECT COALESCE(sum(amount),0) INTO already_refunded FROM payment_refunds WHERE tenant_id=p_tenant AND obligation_id=p_obligation AND source_transaction_id=p_source_transaction;
  IF p_amount>source_allocation-already_refunded THEN RAISE EXCEPTION 'refund amount exceeds refundable payment amount';END IF;
  INSERT INTO payment_refunds(tenant_id,project_id,obligation_id,source_transaction_id,amount,refunded_at,reason,idempotency_key,created_by_membership_id)
  VALUES(p_tenant,obligation.project_id,p_obligation,p_source_transaction,p_amount,p_refunded_at,btrim(p_reason),btrim(p_idempotency_key),p_actor_membership) RETURNING id INTO refund_id;
  INSERT INTO payment_events(tenant_id,project_id,obligation_id,transaction_id,event_type,payload,recorded_by_membership_id)
  VALUES(p_tenant,obligation.project_id,p_obligation,p_source_transaction,'payment.refund_created',jsonb_build_object('refundId',refund_id,'amount',p_amount,'refundedAt',p_refunded_at),p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'payment.refund_created','payment_refund',refund_id,jsonb_build_object('amount',p_amount,'refundedAt',p_refunded_at,'reason',btrim(p_reason)),jsonb_build_object('projectId',obligation.project_id,'obligationId',p_obligation,'sourceTransactionId',p_source_transaction));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'payment_refund',refund_id,'payment.refund_created.v1',jsonb_build_object('refundId',refund_id,'obligationId',p_obligation,'sourceTransactionId',p_source_transaction,'amount',p_amount,'projectId',obligation.project_id));
  RETURN refund_id;
END $$;

ALTER TABLE contract_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY contract_notes_read_policy ON contract_notes FOR SELECT
  USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'contracts.read'));

ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_refunds_read_policy ON payment_refunds FOR SELECT USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'payments.read'));
CREATE POLICY payment_refunds_manage_policy ON payment_refunds FOR ALL USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'payments.manage')) WITH CHECK (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,'payments.manage'));

GRANT SELECT ON contract_notes,payment_refunds TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_contract_addendum(uuid,uuid,text,uuid,text) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.add_contract_note(uuid,uuid,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.archive_contract_note(uuid,uuid,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_payment_refund(uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) TO develocrm_app;

COMMIT;
