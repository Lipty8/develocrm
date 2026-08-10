BEGIN;

INSERT INTO permissions(code,description) VALUES
 ('client_changes.read','Zobrazit klientské změny'),('client_changes.manage','Vytvářet a archivovat klientské změny') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
SELECT role.tenant_id,role.id,permission.id,'workspace' FROM roles role CROSS JOIN permissions permission
WHERE role.code='admin' AND permission.code IN ('client_changes.read','client_changes.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
SELECT role.tenant_id,role.id,permission.id,'project' FROM roles role JOIN permissions permission ON permission.code IN ('client_changes.read','client_changes.manage')
WHERE role.code IN ('project_manager','back_office') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
SELECT role.tenant_id,role.id,permission.id,CASE WHEN role.code='executive' THEN 'workspace' ELSE 'project' END FROM roles role JOIN permissions permission ON permission.code='client_changes.read'
WHERE role.code IN ('executive','sales','finance','read_only') ON CONFLICT DO NOTHING;

CREATE TABLE client_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,unit_id uuid NOT NULL,party_id uuid NOT NULL,sales_case_id uuid,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 2 AND 240),description text,
 source_type text NOT NULL CHECK(source_type IN ('individual','catalog')),catalog_item_code text,
 category text NOT NULL CHECK(length(btrim(category)) BETWEEN 2 AND 100),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','pricing','pending_approval','approved','in_progress','completed','cancelled','archived')),
 surcharge_amount numeric(14,2) CHECK(surcharge_amount IS NULL OR surcharge_amount>=0),currency char(3) NOT NULL DEFAULT 'CZK' CHECK(currency~'^[A-Z]{3}$'),
 requested_at date NOT NULL,due_at date,created_by_membership_id uuid NOT NULL,archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT client_changes_project_fk FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT client_changes_unit_fk FOREIGN KEY(tenant_id,project_id,unit_id) REFERENCES units(tenant_id,project_id,id) ON DELETE RESTRICT,
 CONSTRAINT client_changes_party_fk FOREIGN KEY(tenant_id,party_id) REFERENCES parties(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT client_changes_sales_case_fk FOREIGN KEY(tenant_id,project_id,sales_case_id) REFERENCES sales_cases(tenant_id,project_id,id) ON DELETE RESTRICT,
 CONSTRAINT client_changes_creator_fk FOREIGN KEY(tenant_id,created_by_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT client_changes_tenant_pair_uq UNIQUE(tenant_id,id),
 CONSTRAINT client_changes_dates CHECK(due_at IS NULL OR due_at>=requested_at),
 CONSTRAINT client_changes_catalog_shape CHECK((source_type='catalog' AND catalog_item_code IS NOT NULL) OR source_type='individual'),
 CONSTRAINT client_changes_archive_shape CHECK((status='archived')=(archived_at IS NOT NULL))
);
CREATE INDEX client_changes_project_status_idx ON client_changes(tenant_id,project_id,status,requested_at DESC);
CREATE INDEX client_changes_unit_idx ON client_changes(tenant_id,unit_id,requested_at DESC) WHERE archived_at IS NULL;
CREATE INDEX client_changes_party_idx ON client_changes(tenant_id,party_id,requested_at DESC) WHERE archived_at IS NULL;
CREATE TRIGGER client_changes_touch_updated_at BEFORE UPDATE ON client_changes FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE OR REPLACE FUNCTION app.create_client_change(
 p_tenant uuid,p_project uuid,p_unit uuid,p_party uuid,p_title text,p_description text,p_source_type text,p_catalog_item_code text,p_category text,
 p_surcharge_amount numeric,p_currency text,p_requested_at date,p_due_at date,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE change_id uuid:=gen_random_uuid();actor_user uuid;case_id uuid;
BEGIN
 IF NOT app.has_project_permission(p_tenant,p_actor,p_project,'client_changes.manage') THEN RAISE EXCEPTION 'client_changes.manage permission required';END IF;
 SELECT membership.user_id INTO actor_user FROM tenant_memberships membership WHERE membership.tenant_id=p_tenant AND membership.id=p_actor AND membership.status='active';
 IF actor_user IS NULL THEN RAISE EXCEPTION 'active actor membership required';END IF;
 IF NOT EXISTS(SELECT 1 FROM units unit WHERE unit.tenant_id=p_tenant AND unit.project_id=p_project AND unit.id=p_unit AND unit.archived_at IS NULL) THEN RAISE EXCEPTION 'unit must belong to project';END IF;
 IF NOT EXISTS(SELECT 1 FROM parties party JOIN party_project_links link ON link.tenant_id=party.tenant_id AND link.party_id=party.id AND link.project_id=p_project AND link.valid_to IS NULL WHERE party.tenant_id=p_tenant AND party.id=p_party AND party.lifecycle_status='active') THEN RAISE EXCEPTION 'party must be active in project';END IF;
 SELECT sales_case.id INTO case_id FROM sales_cases sales_case JOIN sales_case_parties participant ON participant.tenant_id=sales_case.tenant_id AND participant.sales_case_id=sales_case.id AND participant.party_id=p_party WHERE sales_case.tenant_id=p_tenant AND sales_case.project_id=p_project AND sales_case.unit_id=p_unit AND sales_case.status='active' LIMIT 1;
 INSERT INTO client_changes(id,tenant_id,project_id,unit_id,party_id,sales_case_id,title,description,source_type,catalog_item_code,category,surcharge_amount,currency,requested_at,due_at,created_by_membership_id)
 VALUES(change_id,p_tenant,p_project,p_unit,p_party,case_id,btrim(p_title),NULLIF(btrim(p_description),''),p_source_type,NULLIF(btrim(p_catalog_item_code),''),btrim(p_category),p_surcharge_amount,upper(p_currency),p_requested_at,p_due_at,p_actor);
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata) VALUES(p_tenant,actor_user,'client_change.created','client_change',change_id,jsonb_build_object('title',btrim(p_title),'status','requested','sourceType',p_source_type,'surchargeAmount',p_surcharge_amount),jsonb_build_object('projectId',p_project,'unitId',p_unit,'partyId',p_party,'salesCaseId',case_id));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'client_change',change_id,'client_change.created.v1',jsonb_build_object('clientChangeId',change_id,'projectId',p_project,'unitId',p_unit,'partyId',p_party,'salesCaseId',case_id));
 RETURN change_id;
END $$;

CREATE OR REPLACE FUNCTION app.archive_client_change(p_tenant uuid,p_change uuid,p_actor uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE actor_user uuid;project uuid;before_row jsonb;after_row jsonb;
BEGIN
 SELECT change.project_id,to_jsonb(change) INTO project,before_row FROM client_changes change WHERE change.tenant_id=p_tenant AND change.id=p_change FOR UPDATE;
 IF project IS NULL THEN RAISE EXCEPTION 'client change not found';END IF;
 IF NOT app.has_project_permission(p_tenant,p_actor,project,'client_changes.manage') THEN RAISE EXCEPTION 'client_changes.manage permission required';END IF;
 SELECT membership.user_id INTO actor_user FROM tenant_memberships membership WHERE membership.tenant_id=p_tenant AND membership.id=p_actor AND membership.status='active';
 IF actor_user IS NULL OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'active actor and archive reason required';END IF;
 IF before_row->>'status'='archived' THEN RETURN p_change;END IF;
 UPDATE client_changes SET status='archived',archived_at=now() WHERE tenant_id=p_tenant AND id=p_change RETURNING to_jsonb(client_changes) INTO after_row;
 INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata) VALUES(p_tenant,actor_user,'client_change.archived','client_change',p_change,before_row,after_row,jsonb_build_object('projectId',project,'reason',btrim(p_reason)));
 INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(p_tenant,'client_change',p_change,'client_change.archived.v1',jsonb_build_object('clientChangeId',p_change,'projectId',project,'reason',btrim(p_reason)));
 RETURN p_change;
END $$;

ALTER TABLE client_changes ENABLE ROW LEVEL SECURITY;ALTER TABLE client_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY client_changes_tenant_policy ON client_changes USING(tenant_id=app.current_tenant_id()) WITH CHECK(tenant_id=app.current_tenant_id());
GRANT SELECT,INSERT,UPDATE ON client_changes TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.create_client_change(uuid,uuid,uuid,uuid,text,text,text,text,text,numeric,text,date,date,uuid) TO develocrm_app;
GRANT EXECUTE ON FUNCTION app.archive_client_change(uuid,uuid,uuid,text) TO develocrm_app;
COMMIT;
