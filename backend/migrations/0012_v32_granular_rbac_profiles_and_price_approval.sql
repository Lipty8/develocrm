BEGIN;

ALTER TABLE role_permissions
  ADD COLUMN scope text NOT NULL DEFAULT 'workspace'
  CHECK (scope IN ('workspace','project','own','partner'));

ALTER TABLE users ADD COLUMN profile_initials text;
ALTER TABLE users ADD COLUMN avatar_url text;
ALTER TABLE users ADD COLUMN preferred_language text NOT NULL DEFAULT 'cs' CHECK (preferred_language IN ('cs','en'));
ALTER TABLE users ADD COLUMN profile_timezone text NOT NULL DEFAULT 'Europe/Prague';
ALTER TABLE users ADD COLUMN notification_settings jsonb NOT NULL DEFAULT '{"email":true,"inApp":true}'::jsonb;
ALTER TABLE users ADD COLUMN profile_name_overridden boolean NOT NULL DEFAULT false;

INSERT INTO permissions(code,description) VALUES
 ('projects.read','Projekty · čtení'),('projects.update','Projekty · úpravy'),
 ('units.read','Jednotky · čtení'),('units.update','Jednotky · úpravy'),
 ('units.update_sales_status','Jednotky · řízené obchodní operace'),
 ('accessories.read','Příslušenství · čtení'),('accessories.update','Příslušenství · úpravy'),
 ('clients.read_all','Klienti · všichni'),('clients.read_own','Klienti · vlastní partner'),
 ('clients.read_contact_details','Klienti · kontaktní údaje'),('clients.create','Klienti · založení'),('clients.update','Klienti · úpravy'),
 ('sales_cases.read','Sales case · čtení'),('sales_cases.manage','Sales case · správa'),
 ('holds.create','Předrezervace · vytvoření'),('holds.cancel','Předrezervace/rezervace · zrušení'),('holds.confirm','Rezervace · potvrzení'),
 ('contracts.read','Smlouvy · čtení'),('contracts.create','Smlouvy · založení'),('contracts.update','Smlouvy · úpravy'),
 ('contracts.mark_ready','Smlouvy · formální připravenost'),('contracts.record_signature','Smlouvy · podpis'),
 ('documents.read','Dokumenty · čtení'),('documents.create','Dokumenty · založení'),('documents.update','Dokumenty · úpravy'),
 ('documents.review','Dokumenty · formální kontrola'),('documents.archive','Dokumenty · archivace'),
 ('prices.read','Ceny · čtení'),('prices.propose','Ceny · návrh změny'),('prices.approve','Ceny · schválení změny'),
 ('discounts.approve','Slevy · schválení'),('commercial_exceptions.approve','Obchodní výjimky · schválení'),
 ('payments.read','Platby · čtení'),('payments.manage','Platby · správa'),
 ('handovers.read','Předání · čtení'),('handovers.manage','Předání · správa'),
 ('complaints.read','Reklamace · čtení'),('complaints.manage','Reklamace · správa'),
 ('tasks.read','Úkoly · čtení'),('tasks.manage','Úkoly · správa'),
 ('users.manage','Uživatelé · správa'),('roles.manage','Role · správa'),
 ('system.manage','Systém · správa'),('integrations.manage','Integrace · správa'),
 ('exports.run','Exporty · spuštění'),('audit.read','Audit · čtení')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO roles(tenant_id,code,name,description,is_system)
SELECT tenant.id,'executive','Jednatel','Schvaluje ceny, slevy a obchodní výjimky; bez správy systému.',true
FROM tenants tenant
WHERE NOT EXISTS(SELECT 1 FROM roles role WHERE role.tenant_id=tenant.id AND lower(role.code)='executive');
UPDATE roles SET name='Jednatel',description='Schvaluje ceny, slevy a obchodní výjimky; bez správy systému.',is_system=true
WHERE code='executive';

DELETE FROM role_permissions role_permission
USING roles role
WHERE role_permission.tenant_id=role.tenant_id AND role_permission.role_id=role.id AND role.is_system;

WITH grants(role_code,permission_code,scope) AS (VALUES
 ('executive','projects.read','workspace'),('executive','projects.update','workspace'),('executive','units.read','workspace'),('executive','units.update','workspace'),
 ('executive','clients.read_all','workspace'),('executive','clients.read_contact_details','workspace'),('executive','contracts.read','workspace'),
 ('executive','documents.read','workspace'),('executive','prices.read','workspace'),('executive','prices.propose','workspace'),('executive','prices.approve','workspace'),
 ('executive','discounts.approve','workspace'),('executive','commercial_exceptions.approve','workspace'),('executive','payments.read','workspace'),
 ('executive','handovers.read','workspace'),('executive','tasks.read','workspace'),('executive','exports.run','workspace'),('executive','audit.read','workspace'),

 ('admin','projects.read','workspace'),('admin','projects.update','workspace'),('admin','units.read','workspace'),('admin','units.update','workspace'),
 ('admin','units.update_sales_status','workspace'),('admin','accessories.read','workspace'),('admin','accessories.update','workspace'),
 ('admin','clients.read_all','workspace'),('admin','clients.read_contact_details','workspace'),('admin','clients.create','workspace'),('admin','clients.update','workspace'),
 ('admin','interests.manage','workspace'),('admin','sales_cases.read','workspace'),('admin','sales_cases.manage','workspace'),
 ('admin','holds.create','workspace'),('admin','holds.cancel','workspace'),('admin','holds.confirm','workspace'),
 ('admin','contracts.read','workspace'),('admin','contracts.create','workspace'),('admin','contracts.update','workspace'),('admin','contracts.mark_ready','workspace'),('admin','contracts.record_signature','workspace'),
 ('admin','documents.read','workspace'),('admin','documents.create','workspace'),('admin','documents.update','workspace'),('admin','documents.review','workspace'),('admin','documents.archive','workspace'),
 ('admin','prices.read','workspace'),('admin','prices.propose','workspace'),('admin','payments.read','workspace'),('admin','payments.manage','workspace'),
 ('admin','handovers.read','workspace'),('admin','handovers.manage','workspace'),('admin','complaints.read','workspace'),('admin','complaints.manage','workspace'),
 ('admin','tasks.read','workspace'),('admin','tasks.manage','workspace'),('admin','users.manage','workspace'),('admin','roles.manage','workspace'),
 ('admin','system.manage','workspace'),('admin','integrations.manage','workspace'),('admin','exports.run','workspace'),('admin','audit.read','workspace'),

 ('project_manager','projects.read','project'),('project_manager','projects.update','project'),('project_manager','units.read','project'),('project_manager','units.update','project'),
 ('project_manager','units.update_sales_status','project'),('project_manager','accessories.read','project'),('project_manager','accessories.update','project'),
 ('project_manager','clients.read_all','project'),('project_manager','clients.read_contact_details','project'),('project_manager','clients.create','project'),('project_manager','clients.update','project'),
 ('project_manager','interests.manage','project'),('project_manager','sales_cases.read','project'),('project_manager','sales_cases.manage','project'),
 ('project_manager','holds.create','project'),('project_manager','holds.cancel','project'),('project_manager','holds.confirm','project'),
 ('project_manager','contracts.read','project'),('project_manager','contracts.create','project'),('project_manager','contracts.update','project'),
 ('project_manager','documents.read','project'),('project_manager','documents.create','project'),('project_manager','documents.update','project'),
 ('project_manager','prices.read','project'),('project_manager','prices.propose','project'),('project_manager','payments.read','project'),
 ('project_manager','handovers.read','project'),('project_manager','handovers.manage','project'),('project_manager','tasks.read','project'),('project_manager','tasks.manage','project'),

 ('sales','projects.read','project'),('sales','units.read','project'),('sales','accessories.read','project'),
 ('sales','clients.read_own','partner'),('sales','clients.read_contact_details','own'),('sales','clients.create','partner'),('sales','clients.update','own'),
 ('sales','interests.manage','own'),('sales','sales_cases.read','own'),('sales','sales_cases.manage','own'),
 ('sales','holds.create','own'),('sales','holds.cancel','own'),

 ('back_office','projects.read','project'),('back_office','units.read','project'),('back_office','clients.read_all','project'),('back_office','clients.read_contact_details','project'),
 ('back_office','clients.create','project'),('back_office','clients.update','project'),('back_office','sales_cases.read','project'),
 ('back_office','contracts.read','project'),('back_office','contracts.create','project'),('back_office','contracts.update','project'),('back_office','contracts.mark_ready','project'),('back_office','contracts.record_signature','project'),
 ('back_office','documents.read','project'),('back_office','documents.create','project'),('back_office','documents.update','project'),('back_office','documents.review','project'),
 ('back_office','tasks.read','project'),('back_office','tasks.manage','project'),

 ('finance','projects.read','project'),('finance','units.read','project'),('finance','clients.read_all','project'),('finance','contracts.read','project'),
 ('finance','documents.read','project'),('finance','prices.read','project'),('finance','payments.read','project'),('finance','payments.manage','project'),('finance','exports.run','project'),

 ('handover_complaints','projects.read','project'),('handover_complaints','units.read','project'),('handover_complaints','clients.read_all','project'),('handover_complaints','clients.read_contact_details','project'),
 ('handover_complaints','handovers.read','project'),('handover_complaints','handovers.manage','project'),('handover_complaints','complaints.read','project'),('handover_complaints','complaints.manage','project'),
 ('handover_complaints','tasks.read','project'),('handover_complaints','tasks.manage','project'),

 ('read_only','projects.read','project'),('read_only','units.read','project'),('read_only','accessories.read','project'),('read_only','clients.read_all','project'),
 ('read_only','sales_cases.read','project'),('read_only','contracts.read','project'),('read_only','documents.read','project'),('read_only','prices.read','project'),
 ('read_only','payments.read','project'),('read_only','handovers.read','project'),('read_only','tasks.read','project')
)
INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
SELECT role.tenant_id,role.id,permission.id,grants.scope
FROM grants JOIN roles role ON role.code=grants.role_code JOIN permissions permission ON permission.code=grants.permission_code
ON CONFLICT(tenant_id,role_id,permission_id) DO UPDATE SET scope=EXCLUDED.scope;

CREATE OR REPLACE FUNCTION app.has_project_permission(p_tenant_id uuid,p_membership_id uuid,p_project_id uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,app AS $$
  SELECT EXISTS(
    SELECT 1 FROM (
      SELECT assignment.role_id FROM role_assignments assignment
      WHERE assignment.tenant_id=p_tenant_id AND assignment.membership_id=p_membership_id
      UNION
      SELECT assignment.role_id FROM project_role_assignments assignment
      WHERE assignment.tenant_id=p_tenant_id AND assignment.membership_id=p_membership_id AND assignment.project_id=p_project_id
    ) assigned
    JOIN role_permissions grant_row ON grant_row.tenant_id=p_tenant_id AND grant_row.role_id=assigned.role_id
    JOIN permissions permission ON permission.id=grant_row.permission_id
    WHERE permission.code=ANY(CASE p_permission
      WHEN 'project.read' THEN ARRAY['projects.read']
      WHEN 'project.manage' THEN ARRAY['projects.update']
      WHEN 'unit.read' THEN ARRAY['units.read']
      WHEN 'unit.manage' THEN ARRAY['units.update']
      WHEN 'accessory.read' THEN ARRAY['accessories.read']
      WHEN 'accessory.manage' THEN ARRAY['accessories.update']
      WHEN 'clients.read' THEN ARRAY['clients.read_all','clients.read_own']
      WHEN 'clients.manage' THEN ARRAY['clients.create','clients.update']
      WHEN 'clients.export' THEN ARRAY['exports.run']
      WHEN 'sales_case.read' THEN ARRAY['sales_cases.read']
      WHEN 'sales_case.manage' THEN ARRAY['sales_cases.manage']
      WHEN 'holds.manage' THEN ARRAY['holds.create','holds.confirm']
      WHEN 'price.read' THEN ARRAY['prices.read']
      WHEN 'price.manage' THEN ARRAY['prices.propose']
      WHEN 'price.approve' THEN ARRAY['prices.approve']
      WHEN 'contract.read' THEN ARRAY['contracts.read']
      WHEN 'contract.manage' THEN ARRAY['contracts.create','contracts.update']
      WHEN 'contract.approve' THEN ARRAY['contracts.mark_ready']
      WHEN 'contract.sign' THEN ARRAY['contracts.record_signature']
      WHEN 'documents.view' THEN ARRAY['documents.read']
      WHEN 'documents.upload' THEN ARRAY['documents.create']
      WHEN 'documents.edit_metadata' THEN ARRAY['documents.update']
      WHEN 'documents.manage' THEN ARRAY['documents.update']
      WHEN 'handover.read' THEN ARRAY['handovers.read']
      WHEN 'handover.manage' THEN ARRAY['handovers.manage']
      ELSE ARRAY[p_permission] END)
  )
$$;

CREATE TABLE unit_price_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, unit_id uuid NOT NULL,
  price_type text NOT NULL CHECK(price_type IN ('list_price','individual_discount','sale_price','contract_price')),
  current_amount numeric(15,2), proposed_amount numeric(15,2) NOT NULL CHECK(proposed_amount>=0), currency char(3) NOT NULL DEFAULT 'CZK',
  valid_from timestamptz NOT NULL, reason text NOT NULL CHECK(length(btrim(reason))>=3),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  proposed_by_membership_id uuid NOT NULL, proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by_membership_id uuid, decided_at timestamptz, decision_reason text,
  CONSTRAINT price_proposal_unit_fk FOREIGN KEY(tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
  CONSTRAINT price_proposal_author_fk FOREIGN KEY(tenant_id,proposed_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT price_proposal_decider_fk FOREIGN KEY(tenant_id,decided_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT price_proposal_tenant_uq UNIQUE(tenant_id,id),
  CONSTRAINT price_proposal_decision_shape CHECK((status='pending')=(decided_at IS NULL AND decided_by_membership_id IS NULL))
);
CREATE UNIQUE INDEX one_pending_unit_price_proposal ON unit_price_proposals(tenant_id,unit_id,price_type) WHERE status='pending';

CREATE OR REPLACE FUNCTION app.propose_unit_price(p_tenant uuid,p_unit uuid,p_price_type text,p_amount numeric,p_currency text,p_valid_from timestamptz,p_reason text,p_actor_membership uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE project uuid; actor uuid; proposal_id uuid:=gen_random_uuid(); current_price numeric;
BEGIN
 SELECT project_id INTO project FROM units WHERE tenant_id=p_tenant AND id=p_unit FOR UPDATE;
 SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
 IF project IS NULL OR actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,project,'prices.propose') THEN RAISE EXCEPTION 'prices.propose permission required'; END IF;
 SELECT app.current_unit_price(p_tenant,p_unit,p_valid_from) INTO current_price;
 INSERT INTO unit_price_proposals(id,tenant_id,project_id,unit_id,price_type,current_amount,proposed_amount,currency,valid_from,reason,proposed_by_membership_id)
 VALUES(proposal_id,p_tenant,project,p_unit,p_price_type,current_price,p_amount,upper(p_currency),p_valid_from,p_reason,p_actor_membership);
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
 VALUES(p_tenant,actor,'unit.price_proposed','unit_price_proposal',proposal_id,jsonb_build_object('unitId',p_unit,'amount',p_amount,'reason',p_reason));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'unit',p_unit,'unit.price_proposed.v1',jsonb_build_object('proposalId',proposal_id,'unitId',p_unit,'amount',p_amount));
 RETURN proposal_id;
END $$;

CREATE OR REPLACE FUNCTION app.decide_unit_price_proposal(p_tenant uuid,p_proposal uuid,p_decision text,p_reason text,p_actor_membership uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE proposal unit_price_proposals%ROWTYPE; actor uuid; price_id uuid;
BEGIN
 SELECT * INTO proposal FROM unit_price_proposals WHERE tenant_id=p_tenant AND id=p_proposal FOR UPDATE;
 SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
 IF proposal.id IS NULL OR proposal.status<>'pending' OR p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'pending proposal and valid decision are required'; END IF;
 IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,proposal.project_id,'prices.approve') THEN RAISE EXCEPTION 'prices.approve permission required'; END IF;
 UPDATE unit_price_proposals SET status=p_decision,decided_by_membership_id=p_actor_membership,decided_at=now(),decision_reason=p_reason WHERE tenant_id=p_tenant AND id=p_proposal;
 IF p_decision='approved' THEN
   price_id:=gen_random_uuid();
   INSERT INTO unit_price_history(id,tenant_id,project_id,unit_id,price_type,amount,currency,valid_from,reason,recorded_by_membership_id,approved_by_membership_id,approved_at)
   VALUES(price_id,p_tenant,proposal.project_id,proposal.unit_id,proposal.price_type,proposal.proposed_amount,proposal.currency,proposal.valid_from,proposal.reason,proposal.proposed_by_membership_id,p_actor_membership,now());
 END IF;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
 VALUES(p_tenant,actor,'unit.price_proposal_decided','unit_price_proposal',p_proposal,jsonb_build_object('status','pending'),jsonb_build_object('status',p_decision,'reason',p_reason,'priceId',price_id));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
 VALUES(p_tenant,'unit_price_proposal',p_proposal,'unit.price_proposal_decided.v1',jsonb_build_object('proposalId',p_proposal,'decision',p_decision,'priceId',price_id));
 RETURN price_id;
END $$;

CREATE OR REPLACE FUNCTION app.record_unit_price(p_tenant uuid,p_unit uuid,p_price_type text,p_amount numeric,p_currency text,p_valid_from timestamptz,p_reason text,p_actor_membership uuid,p_approver_membership uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
 IF p_approver_membership IS NOT NULL THEN RAISE EXCEPTION 'price approval must use the proposal decision command'; END IF;
 RETURN app.propose_unit_price(p_tenant,p_unit,p_price_type,p_amount,p_currency,p_valid_from,p_reason,p_actor_membership);
END $$;

ALTER TABLE unit_price_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_price_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_price_proposals_tenant ON unit_price_proposals
 USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT,UPDATE ON unit_price_proposals TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.propose_unit_price(uuid,uuid,text,numeric,text,timestamptz,text,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.decide_unit_price_proposal(uuid,uuid,text,text,uuid) TO develocrm_app;

COMMIT;
