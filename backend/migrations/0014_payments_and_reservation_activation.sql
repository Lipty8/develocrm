BEGIN;

ALTER TABLE sales_cases ADD COLUMN reservation_activated_at timestamptz;
ALTER TABLE contracts ADD COLUMN reservation_fee_amount numeric(14,2) CHECK (reservation_fee_amount IS NULL OR reservation_fee_amount>0);
ALTER TABLE contracts ADD COLUMN reservation_fee_due_days integer NOT NULL DEFAULT 5 CHECK (reservation_fee_due_days BETWEEN 1 AND 30);

CREATE TABLE payment_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  party_id uuid NOT NULL,
  sales_case_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  obligation_type text NOT NULL CHECK (obligation_type IN ('reservation_fee','purchase_installment','purchase_balance','client_change','other')),
  label text NOT NULL CHECK (length(btrim(label))>=3),
  amount numeric(14,2) NOT NULL CHECK (amount>0),
  currency text NOT NULL DEFAULT 'CZK' CHECK (currency='CZK'),
  due_at timestamptz NOT NULL,
  variable_symbol text,
  idempotency_key text NOT NULL,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_obligation_unit_fk FOREIGN KEY (tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_obligation_party_fk FOREIGN KEY (tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_obligation_case_fk FOREIGN KEY (tenant_id,project_id,sales_case_id) REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_obligation_contract_fk FOREIGN KEY (tenant_id,project_id,contract_id) REFERENCES contracts(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_obligation_actor_fk FOREIGN KEY (tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_obligation_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT payment_obligation_idempotency_uq UNIQUE (tenant_id,idempotency_key)
);
CREATE UNIQUE INDEX payment_reservation_fee_contract_uq ON payment_obligations(tenant_id,contract_id)
  WHERE obligation_type='reservation_fee' AND cancelled_at IS NULL;
CREATE INDEX payment_obligations_due_idx ON payment_obligations(tenant_id,project_id,due_at,id);

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount>0),
  currency text NOT NULL DEFAULT 'CZK' CHECK (currency='CZK'),
  paid_at timestamptz NOT NULL,
  variable_symbol text,
  counterparty_account text,
  bank_transaction_id text,
  note text,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_transaction_project_fk FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_transaction_actor_fk FOREIGN KEY (tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_transaction_tenant_pair_uq UNIQUE (tenant_id,id)
);
CREATE UNIQUE INDEX payment_transaction_bank_uq ON payment_transactions(tenant_id,bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount>0),
  allocated_by_membership_id uuid NOT NULL,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_allocation_obligation_fk FOREIGN KEY (tenant_id,obligation_id) REFERENCES payment_obligations(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_allocation_transaction_fk FOREIGN KEY (tenant_id,transaction_id) REFERENCES payment_transactions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_allocation_actor_fk FOREIGN KEY (tenant_id,allocated_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_allocation_tenant_pair_uq UNIQUE (tenant_id,id),
  CONSTRAINT payment_allocation_transaction_obligation_uq UNIQUE (tenant_id,transaction_id,obligation_id)
);

CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason))>=3),
  reversed_by_membership_id uuid NOT NULL,
  reversed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_reversal_transaction_fk FOREIGN KEY (tenant_id,transaction_id) REFERENCES payment_transactions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_reversal_actor_fk FOREIGN KEY (tenant_id,reversed_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_reversal_transaction_uq UNIQUE (tenant_id,transaction_id),
  CONSTRAINT payment_reversal_tenant_pair_uq UNIQUE (tenant_id,id)
);

CREATE TABLE payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  obligation_id uuid,
  transaction_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_event_obligation_fk FOREIGN KEY (tenant_id,obligation_id) REFERENCES payment_obligations(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_event_transaction_fk FOREIGN KEY (tenant_id,transaction_id) REFERENCES payment_transactions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_event_actor_fk FOREIGN KEY (tenant_id,recorded_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX payment_events_history_idx ON payment_events(tenant_id,obligation_id,recorded_at DESC,id DESC);
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION app.reject_append_only();

CREATE TABLE bank_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  file_name text NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','confirmed','cancelled')),
  imported_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT bank_import_actor_fk FOREIGN KEY (tenant_id,imported_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT bank_import_tenant_pair_uq UNIQUE (tenant_id,id)
);
CREATE TABLE bank_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number>0),
  bank_transaction_id text NOT NULL,
  paid_at timestamptz NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount>0),
  variable_symbol text,
  counterparty_account text,
  proposed_obligation_id uuid,
  duplicate boolean NOT NULL DEFAULT false,
  confidence numeric(5,2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  confirmed_transaction_id uuid,
  CONSTRAINT bank_import_row_batch_fk FOREIGN KEY (tenant_id,batch_id) REFERENCES bank_import_batches(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT bank_import_row_obligation_fk FOREIGN KEY (tenant_id,proposed_obligation_id) REFERENCES payment_obligations(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT bank_import_row_transaction_fk FOREIGN KEY (tenant_id,confirmed_transaction_id) REFERENCES payment_transactions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT bank_import_row_uq UNIQUE (tenant_id,batch_id,row_number),
  CONSTRAINT bank_import_bank_id_uq UNIQUE (tenant_id,bank_transaction_id)
);

CREATE OR REPLACE FUNCTION app.payment_obligation_paid(p_tenant uuid,p_obligation uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(allocation.amount) FILTER (WHERE reversal.id IS NULL),0)
  FROM payment_allocations allocation
  JOIN payment_transactions transaction ON transaction.tenant_id=allocation.tenant_id AND transaction.id=allocation.transaction_id
  LEFT JOIN payment_reversals reversal ON reversal.tenant_id=transaction.tenant_id AND reversal.transaction_id=transaction.id
  WHERE allocation.tenant_id=p_tenant AND allocation.obligation_id=p_obligation
$$;

CREATE OR REPLACE FUNCTION app.payment_obligation_status(p_tenant uuid,p_obligation uuid,p_now timestamptz DEFAULT now())
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN obligation.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN app.payment_obligation_paid(p_tenant,p_obligation)>obligation.amount THEN 'overpaid'
    WHEN app.payment_obligation_paid(p_tenant,p_obligation)=obligation.amount THEN 'paid'
    WHEN obligation.due_at<p_now THEN 'overdue'
    WHEN app.payment_obligation_paid(p_tenant,p_obligation)>0 THEN 'partially_paid'
    ELSE 'pending'
  END
  FROM payment_obligations obligation WHERE obligation.tenant_id=p_tenant AND obligation.id=p_obligation
$$;

CREATE OR REPLACE FUNCTION app.ensure_rs_reservation_fee()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_party uuid; fee_amount numeric; fee_days integer; obligation_id uuid; actor uuid;
BEGIN
  IF NEW.current_status='signed' AND OLD.current_status IS DISTINCT FROM 'signed' AND NEW.contract_type='rs' THEN
    SELECT party_id INTO case_party FROM sales_case_parties
      WHERE tenant_id=NEW.tenant_id AND sales_case_id=NEW.sales_case_id AND participant_role IN ('buyer','co_buyer')
      ORDER BY is_primary DESC,joined_at LIMIT 1;
    fee_amount:=COALESCE(NEW.reservation_fee_amount,250000);
    fee_days:=NEW.reservation_fee_due_days;
    SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=NEW.tenant_id AND id=NEW.created_by_membership_id;
    INSERT INTO payment_obligations(tenant_id,project_id,unit_id,party_id,sales_case_id,contract_id,obligation_type,label,amount,due_at,variable_symbol,idempotency_key,created_by_membership_id)
    VALUES(NEW.tenant_id,NEW.project_id,NEW.unit_id,case_party,NEW.sales_case_id,NEW.id,'reservation_fee','Rezervační poplatek',fee_amount,now()+make_interval(days=>fee_days),
      regexp_replace(NEW.reference,'\D','','g'),'rs-fee:'||NEW.id,NEW.created_by_membership_id)
    ON CONFLICT (tenant_id,idempotency_key) DO NOTHING RETURNING id INTO obligation_id;
    IF obligation_id IS NOT NULL THEN
      INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id)
      VALUES(NEW.tenant_id,NEW.project_id,obligation_id,'obligation.created',jsonb_build_object('amount',fee_amount,'source','signed_rs'),NEW.created_by_membership_id);
      INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
      VALUES(NEW.tenant_id,actor,'payment.obligation_created','payment_obligation',obligation_id,jsonb_build_object('amount',fee_amount,'contractId',NEW.id));
      INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
      VALUES(NEW.tenant_id,'payment_obligation',obligation_id,'payment.obligation_created.v1',jsonb_build_object('obligationId',obligation_id,'unitId',NEW.unit_id,'contractId',NEW.id,'amount',fee_amount));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_signed_create_reservation_fee AFTER UPDATE OF current_status ON contracts
FOR EACH ROW EXECUTE FUNCTION app.ensure_rs_reservation_fee();

CREATE OR REPLACE FUNCTION app.require_reservation_payment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hold_type='reservation' AND NEW.status='active' AND NOT EXISTS (
    SELECT 1 FROM contracts contract
    JOIN payment_obligations obligation ON obligation.tenant_id=contract.tenant_id AND obligation.contract_id=contract.id AND obligation.obligation_type='reservation_fee' AND obligation.cancelled_at IS NULL
    WHERE contract.tenant_id=NEW.tenant_id AND contract.sales_case_id=NEW.sales_case_id AND contract.contract_type='rs' AND contract.current_status='signed'
      AND app.payment_obligation_paid(obligation.tenant_id,obligation.id)>=obligation.amount
  ) THEN RAISE EXCEPTION 'reservation requires signed RS and fully paid reservation fee'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER unit_hold_reservation_payment_guard BEFORE INSERT OR UPDATE OF hold_type,status ON unit_holds
FOR EACH ROW EXECUTE FUNCTION app.require_reservation_payment();

CREATE OR REPLACE FUNCTION app.create_payment_obligation(
  p_tenant uuid,p_project uuid,p_unit uuid,p_party uuid,p_sales_case uuid,p_contract uuid,p_type text,p_label text,
  p_amount numeric,p_due_at timestamptz,p_variable_symbol text,p_idempotency_key text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid; actor uuid;
BEGIN
  SELECT id INTO result FROM payment_obligations WHERE tenant_id=p_tenant AND idempotency_key=p_idempotency_key;
  IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,p_project,'payments.manage') THEN RAISE EXCEPTION 'payments.manage permission required'; END IF;
  INSERT INTO payment_obligations(tenant_id,project_id,unit_id,party_id,sales_case_id,contract_id,obligation_type,label,amount,due_at,variable_symbol,idempotency_key,created_by_membership_id)
  VALUES(p_tenant,p_project,p_unit,p_party,p_sales_case,p_contract,p_type,p_label,p_amount,p_due_at,p_variable_symbol,p_idempotency_key,p_actor_membership)
  RETURNING id INTO result;
  INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id)
  VALUES(p_tenant,p_project,result,'obligation.created',jsonb_build_object('amount',p_amount,'type',p_type),p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'payment.obligation_created','payment_obligation',result,jsonb_build_object('amount',p_amount,'type',p_type));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'payment_obligation',result,'payment.obligation_created.v1',jsonb_build_object('obligationId',result,'unitId',p_unit,'amount',p_amount));
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION app.record_payment(
  p_tenant uuid,p_obligation uuid,p_amount numeric,p_paid_at timestamptz,p_variable_symbol text,p_account text,
  p_bank_transaction_id text,p_note text,p_actor_membership uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE obligation payment_obligations%ROWTYPE; transaction_id uuid; actor uuid; unit_status text; old_hold uuid;
BEGIN
  SELECT * INTO obligation FROM payment_obligations WHERE tenant_id=p_tenant AND id=p_obligation FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF obligation.id IS NULL OR obligation.cancelled_at IS NOT NULL OR p_amount<=0 THEN RAISE EXCEPTION 'active obligation and positive amount required'; END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,obligation.project_id,'payments.manage') THEN RAISE EXCEPTION 'payments.manage permission required'; END IF;
  IF p_bank_transaction_id IS NOT NULL THEN SELECT id INTO transaction_id FROM payment_transactions WHERE tenant_id=p_tenant AND bank_transaction_id=p_bank_transaction_id; END IF;
  IF transaction_id IS NULL THEN
    INSERT INTO payment_transactions(tenant_id,project_id,amount,paid_at,variable_symbol,counterparty_account,bank_transaction_id,note,created_by_membership_id)
    VALUES(p_tenant,obligation.project_id,p_amount,p_paid_at,p_variable_symbol,p_account,p_bank_transaction_id,p_note,p_actor_membership) RETURNING id INTO transaction_id;
    INSERT INTO payment_allocations(tenant_id,project_id,obligation_id,transaction_id,amount,allocated_by_membership_id)
    VALUES(p_tenant,obligation.project_id,obligation.id,transaction_id,p_amount,p_actor_membership);
    INSERT INTO payment_events(tenant_id,project_id,obligation_id,transaction_id,event_type,payload,recorded_by_membership_id)
    VALUES(p_tenant,obligation.project_id,obligation.id,transaction_id,'payment.recorded',jsonb_build_object('amount',p_amount),p_actor_membership);
    INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
    VALUES(p_tenant,actor,'payment.recorded','payment_transaction',transaction_id,jsonb_build_object('obligationId',obligation.id,'amount',p_amount));
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'payment_transaction',transaction_id,'payment.recorded.v1',jsonb_build_object('transactionId',transaction_id,'obligationId',obligation.id,'amount',p_amount));
  END IF;
  IF obligation.obligation_type='reservation_fee' AND app.payment_obligation_paid(p_tenant,obligation.id)>=obligation.amount
     AND EXISTS(SELECT 1 FROM contracts WHERE tenant_id=p_tenant AND id=obligation.contract_id AND contract_type='rs' AND current_status='signed')
     AND NOT EXISTS(SELECT 1 FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=obligation.unit_id AND hold_type='reservation' AND status='active') THEN
    SELECT id INTO old_hold FROM unit_holds WHERE tenant_id=p_tenant AND unit_id=obligation.unit_id AND hold_type='pre_reservation' AND status='active' FOR UPDATE;
    IF old_hold IS NOT NULL THEN UPDATE unit_holds SET status='converted',ended_at=now() WHERE tenant_id=p_tenant AND id=old_hold; END IF;
    INSERT INTO unit_holds(tenant_id,project_id,unit_id,sales_case_id,hold_type,starts_at,expires_at,idempotency_key,created_by_membership_id)
    VALUES(p_tenant,obligation.project_id,obligation.unit_id,obligation.sales_case_id,'reservation',now(),now()+interval '365 days','paid-rs-fee:'||obligation.id,p_actor_membership);
    SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=obligation.unit_id FOR UPDATE;
    PERFORM app.transition_unit_commercial_status(p_tenant,obligation.unit_id,'reserved',CASE unit_status WHEN 'pre_reserved' THEN 'confirmReservation' ELSE 'createReservation' END,'Podepsaná RS a plně uhrazený rezervační poplatek',p_actor_membership);
    UPDATE sales_cases SET reservation_activated_at=now() WHERE tenant_id=p_tenant AND id=obligation.sales_case_id;
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'unit',obligation.unit_id,'reservation.activated.v1',jsonb_build_object('unitId',obligation.unit_id,'obligationId',obligation.id,'contractId',obligation.contract_id));
  END IF;
  RETURN transaction_id;
END $$;

CREATE OR REPLACE FUNCTION app.reverse_payment(p_tenant uuid,p_transaction uuid,p_reason text,p_actor_membership uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE transaction payment_transactions%ROWTYPE; result uuid; actor uuid; obligation payment_obligations%ROWTYPE; unit_status text;
BEGIN
  SELECT * INTO transaction FROM payment_transactions WHERE tenant_id=p_tenant AND id=p_transaction FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF transaction.id IS NULL THEN RAISE EXCEPTION 'payment transaction not found'; END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,transaction.project_id,'payments.reverse') THEN RAISE EXCEPTION 'payments.reverse permission required'; END IF;
  SELECT id INTO result FROM payment_reversals WHERE tenant_id=p_tenant AND transaction_id=p_transaction;
  IF result IS NOT NULL THEN RETURN result; END IF;
  INSERT INTO payment_reversals(tenant_id,project_id,transaction_id,reason,reversed_by_membership_id)
  VALUES(p_tenant,transaction.project_id,p_transaction,p_reason,p_actor_membership) RETURNING id INTO result;
  INSERT INTO payment_events(tenant_id,project_id,transaction_id,event_type,payload,recorded_by_membership_id)
  VALUES(p_tenant,transaction.project_id,p_transaction,'payment.reversed',jsonb_build_object('reason',p_reason),p_actor_membership);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  VALUES(p_tenant,actor,'payment.reversed','payment_transaction',p_transaction,jsonb_build_object('reason',p_reason));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'payment_transaction',p_transaction,'payment.reversed.v1',jsonb_build_object('transactionId',p_transaction,'reason',p_reason));
  SELECT target.* INTO obligation FROM payment_allocations allocation JOIN payment_obligations target
    ON target.tenant_id=allocation.tenant_id AND target.id=allocation.obligation_id
    WHERE allocation.tenant_id=p_tenant AND allocation.transaction_id=p_transaction AND target.obligation_type='reservation_fee' LIMIT 1;
  IF obligation.id IS NOT NULL AND app.payment_obligation_paid(p_tenant,obligation.id)<obligation.amount
    AND NOT EXISTS(SELECT 1 FROM payment_obligations other WHERE other.tenant_id=p_tenant AND other.unit_id=obligation.unit_id
      AND other.id<>obligation.id AND other.obligation_type='reservation_fee' AND other.cancelled_at IS NULL
      AND app.payment_obligation_paid(other.tenant_id,other.id)>=other.amount) THEN
    UPDATE unit_holds SET status='cancelled',ended_at=now() WHERE tenant_id=p_tenant AND unit_id=obligation.unit_id AND hold_type='reservation' AND status='active';
    SELECT commercial_status INTO unit_status FROM units WHERE tenant_id=p_tenant AND id=obligation.unit_id FOR UPDATE;
    IF unit_status='reserved' THEN
      PERFORM app.transition_unit_commercial_status(p_tenant,obligation.unit_id,'available','cancelReservation','Reverzace rezervačního poplatku: '||p_reason,p_actor_membership);
    END IF;
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'unit',obligation.unit_id,'reservation.suspended.v1',jsonb_build_object('unitId',obligation.unit_id,'obligationId',obligation.id,'reason',p_reason));
  END IF;
  RETURN result;
END $$;

INSERT INTO permissions(code,description) VALUES
 ('payments.read','Zobrazit platební přehledy'),('payments.manage','Spravovat platební předpisy'),
 ('payments.record','Evidovat a párovat úhrady'),('payments.reverse','Provádět reverzace plateb'),
 ('payments.import','Importovat bankovní výpisy'),('payments.export','Exportovat finanční přehledy'),
 ('payments.reservation_status','Zobrazit pouze stav rezervačního poplatku')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN
 ('payments.read','payments.manage','payments.record','payments.reverse','payments.import','payments.export')
WHERE role.code IN ('admin','finance') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code IN
 ('payments.read','payments.manage','payments.record','payments.reverse','payments.import','payments.export')
WHERE role.code='project_manager' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code='payments.read'
WHERE role.code='back_office' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id)
SELECT role.tenant_id,role.id,permission.id FROM roles role JOIN permissions permission ON permission.code='payments.reservation_status'
WHERE role.code IN ('sales','handover','complaints') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.payment_project_allowed(p_tenant uuid,p_project uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app AS $$
  SELECT EXISTS(
    SELECT 1 FROM tenant_memberships membership
    WHERE membership.tenant_id=p_tenant AND membership.user_id=app.current_user_id() AND membership.status='active'
      AND app.has_project_permission(p_tenant,membership.id,p_project,p_permission)
  )
$$;

CREATE OR REPLACE FUNCTION app.reservation_payment_condition(p_tenant uuid,p_unit uuid,p_membership uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,app AS $$
DECLARE project uuid; result text;
BEGIN
  SELECT project_id INTO project FROM units WHERE tenant_id=p_tenant AND id=p_unit;
  IF project IS NULL OR NOT (app.has_project_permission(p_tenant,p_membership,project,'payments.read')
    OR app.has_project_permission(p_tenant,p_membership,project,'payments.reservation_status')) THEN
    RAISE EXCEPTION 'payments.reservation_status permission required';
  END IF;
  SELECT CASE
    WHEN obligation.id IS NULL THEN 'missing_obligation'
    WHEN app.payment_obligation_paid(p_tenant,obligation.id)>=obligation.amount THEN 'paid'
    ELSE 'waiting_for_fee'
  END INTO result
  FROM contracts contract LEFT JOIN payment_obligations obligation ON obligation.tenant_id=contract.tenant_id
    AND obligation.contract_id=contract.id AND obligation.obligation_type='reservation_fee' AND obligation.cancelled_at IS NULL
  WHERE contract.tenant_id=p_tenant AND contract.unit_id=p_unit AND contract.contract_type='rs' AND contract.current_status='signed'
  ORDER BY contract.signed_at DESC NULLS LAST LIMIT 1;
  RETURN COALESCE(result,'missing_signed_rs');
END $$;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['payment_obligations','payment_transactions','payment_allocations','payment_reversals','payment_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,''payments.read''))',table_name||'_read_policy',table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,''payments.manage'')) WITH CHECK (tenant_id=app.current_tenant_id() AND app.payment_project_allowed(tenant_id,project_id,''payments.manage''))',table_name||'_manage_policy',table_name);
  END LOOP;
END $$;
ALTER TABLE bank_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_import_batches FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION app.payment_tenant_allowed(p_tenant uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app AS $$
  SELECT EXISTS(SELECT 1 FROM tenant_memberships membership
    JOIN role_assignments assignment ON assignment.tenant_id=membership.tenant_id AND assignment.membership_id=membership.id
    JOIN role_permissions grant_row ON grant_row.tenant_id=assignment.tenant_id AND grant_row.role_id=assignment.role_id
    JOIN permissions permission ON permission.id=grant_row.permission_id
    WHERE membership.tenant_id=p_tenant AND membership.user_id=app.current_user_id() AND membership.status='active' AND permission.code=p_permission)
$$;
CREATE POLICY bank_import_batches_tenant_policy ON bank_import_batches
  USING (tenant_id=app.current_tenant_id() AND app.payment_tenant_allowed(tenant_id,'payments.import'))
  WITH CHECK (tenant_id=app.current_tenant_id() AND app.payment_tenant_allowed(tenant_id,'payments.import'));
ALTER TABLE bank_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_import_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_import_rows_tenant_policy ON bank_import_rows
  USING (tenant_id=app.current_tenant_id() AND app.payment_tenant_allowed(tenant_id,'payments.import'))
  WITH CHECK (tenant_id=app.current_tenant_id() AND app.payment_tenant_allowed(tenant_id,'payments.import'));

GRANT SELECT,INSERT,UPDATE ON payment_obligations,payment_transactions,payment_allocations,payment_reversals,payment_events,bank_import_batches,bank_import_rows TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.payment_obligation_paid(uuid,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.payment_obligation_status(uuid,uuid,timestamptz) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_payment_obligation(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.record_payment(uuid,uuid,numeric,timestamptz,text,text,text,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.reverse_payment(uuid,uuid,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.reservation_payment_condition(uuid,uuid,uuid) TO develocrm_app;

COMMIT;
