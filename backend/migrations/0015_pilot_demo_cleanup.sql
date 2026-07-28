BEGIN;

CREATE TABLE IF NOT EXISTS pilot_data_cleanup_runs (
  cleanup_key text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  executed_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL
);

DO $$
DECLARE
  tenant uuid;
  target_ids uuid[];
  protected_id uuid;
  actor uuid;
  report jsonb;
BEGIN
  FOR tenant IN
    SELECT DISTINCT tenant_id
    FROM projects
    WHERE (code IN ('RJ','PČ','PC','VS') OR lower(name) IN ('rezidence javorová','parková čtvrť','vily stráň'))
      AND lower(name) <> 'rezidence dejvice' AND code <> 'DEJ'
  LOOP
    SELECT id INTO protected_id
    FROM projects
    WHERE tenant_id=tenant AND (code='DEJ' OR lower(name)='rezidence dejvice')
    ORDER BY created_at LIMIT 1;
    IF protected_id IS NULL THEN
      RAISE EXCEPTION 'Pilot cleanup odmítnut: tenant % nemá chráněnou Rezidenci Dejvice', tenant;
    END IF;

    SELECT array_agg(id ORDER BY id) INTO target_ids
    FROM projects
    WHERE tenant_id=tenant
      AND (code IN ('RJ','PČ','PC','VS') OR lower(name) IN ('rezidence javorová','parková čtvrť','vily stráň'))
      AND id <> protected_id AND lower(name) <> 'rezidence dejvice' AND code <> 'DEJ';
    IF target_ids IS NULL OR array_length(target_ids,1)=0 THEN CONTINUE; END IF;

    SELECT user_id INTO actor FROM tenant_memberships
    WHERE tenant_id=tenant AND status='active' ORDER BY accepted_at NULLS LAST,created_at LIMIT 1;

    SELECT jsonb_build_object(
      'projects',(SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) ORDER BY name) FROM projects WHERE id=ANY(target_ids)),
      'byProject',(SELECT jsonb_agg(jsonb_build_object(
        'id',project.id,'code',project.code,'name',project.name,
        'units',(SELECT count(*) FROM units WHERE tenant_id=tenant AND project_id=project.id),
        'parties',(SELECT count(DISTINCT party_id) FROM party_project_links WHERE tenant_id=tenant AND project_id=project.id),
        'interests',(SELECT count(*) FROM unit_interests WHERE tenant_id=tenant AND project_id=project.id),
        'contracts',(SELECT count(*) FROM contracts WHERE tenant_id=tenant AND project_id=project.id),
        'documents',(SELECT count(*) FROM documents WHERE tenant_id=tenant AND project_id=project.id),
        'paymentObligations',(SELECT count(*) FROM payment_obligations WHERE tenant_id=tenant AND project_id=project.id),
        'paymentTransactions',(SELECT count(*) FROM payment_transactions WHERE tenant_id=tenant AND project_id=project.id),
        'handovers',(SELECT count(*) FROM unit_handovers WHERE tenant_id=tenant AND project_id=project.id),
        'tasks',(SELECT count(*) FROM tasks WHERE tenant_id=tenant AND project_id=project.id),
        'historyAndAudit',(
          (SELECT count(*) FROM construction_status_events WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM unit_completion_status_events WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM unit_commercial_status_events WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM accessory_price_history WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM interest_events WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM sales_stage_events WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM unit_price_history WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM contract_status_events WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM document_events WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM payment_events WHERE tenant_id=tenant AND project_id=project.id)+
          (SELECT count(*) FROM audit_log WHERE tenant_id=tenant AND entity_id=project.id)
        )
      ) ORDER BY project.name) FROM projects project WHERE project.id=ANY(target_ids)),
      'units',(SELECT count(*) FROM units WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'parties',(SELECT count(DISTINCT party_id) FROM party_project_links WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'interests',(SELECT count(*) FROM unit_interests WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'salesCases',(SELECT count(*) FROM sales_cases WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'contracts',(SELECT count(*) FROM contracts WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'documents',(SELECT count(*) FROM documents WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'paymentObligations',(SELECT count(*) FROM payment_obligations WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'paymentTransactions',(SELECT count(*) FROM payment_transactions WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'handovers',(SELECT count(*) FROM unit_handovers WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'tasks',(SELECT count(*) FROM tasks WHERE tenant_id=tenant AND project_id=ANY(target_ids)),
      'historyAndAudit',(
        (SELECT count(*) FROM construction_status_events WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM unit_completion_status_events WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM unit_commercial_status_events WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM accessory_price_history WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM interest_events WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM sales_stage_events WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM unit_price_history WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM contract_status_events WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM document_events WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM payment_events WHERE tenant_id=tenant AND project_id=ANY(target_ids))+
        (SELECT count(*) FROM audit_log WHERE tenant_id=tenant AND entity_id=ANY(target_ids))
      ),
      'sharedParties',(SELECT count(DISTINCT demo.party_id)
        FROM party_project_links demo
        JOIN party_project_links retained ON retained.tenant_id=demo.tenant_id AND retained.party_id=demo.party_id
        WHERE demo.tenant_id=tenant AND demo.project_id=ANY(target_ids) AND retained.project_id<>ALL(target_ids))
    ) INTO report;

    INSERT INTO pilot_data_cleanup_runs(cleanup_key,tenant_id,report)
    VALUES('pilot-demo-projects-v1:'||tenant,tenant,report)
    ON CONFLICT(cleanup_key) DO NOTHING;

    UPDATE documents SET archived_at=COALESCE(archived_at,now())
    WHERE tenant_id=tenant AND project_id=ANY(target_ids) AND archived_at IS NULL;
    UPDATE tasks SET status='cancelled',updated_at=now()
    WHERE tenant_id=tenant AND project_id=ANY(target_ids) AND status='open';
    UPDATE unit_handovers SET status='cancelled',updated_at=now()
    WHERE tenant_id=tenant AND project_id=ANY(target_ids) AND status NOT IN ('completed','cancelled');
    UPDATE unit_accessory_assignments SET valid_to=COALESCE(valid_to,now()),note=COALESCE(note,'Archivace demo projektu')
    WHERE tenant_id=tenant AND project_id=ANY(target_ids) AND valid_to IS NULL;
    UPDATE accessories SET operational_status='archived',archived_at=COALESCE(archived_at,now()),updated_at=now()
    WHERE tenant_id=tenant AND project_id=ANY(target_ids) AND archived_at IS NULL;
    UPDATE units SET archived_at=COALESCE(archived_at,now()),updated_at=now()
    WHERE tenant_id=tenant AND project_id=ANY(target_ids) AND archived_at IS NULL;
    UPDATE project_structures SET archived_at=COALESCE(archived_at,now()),updated_at=now()
    WHERE tenant_id=tenant AND project_id=ANY(target_ids) AND archived_at IS NULL;

    UPDATE party_contacts SET archived_at=COALESCE(archived_at,now()),updated_at=now()
    WHERE tenant_id=tenant AND party_id IN (
      SELECT demo.party_id FROM party_project_links demo
      WHERE demo.tenant_id=tenant AND demo.project_id=ANY(target_ids)
        AND NOT EXISTS (
          SELECT 1 FROM party_project_links retained
          WHERE retained.tenant_id=demo.tenant_id AND retained.party_id=demo.party_id
            AND retained.project_id<>ALL(target_ids)
        )
    );
    UPDATE parties SET lifecycle_status='archived',archived_at=COALESCE(archived_at,now()),updated_at=now()
    WHERE tenant_id=tenant AND archived_at IS NULL AND id IN (
      SELECT demo.party_id FROM party_project_links demo
      WHERE demo.tenant_id=tenant AND demo.project_id=ANY(target_ids)
        AND NOT EXISTS (
          SELECT 1 FROM party_project_links retained
          WHERE retained.tenant_id=demo.tenant_id AND retained.party_id=demo.party_id
            AND retained.project_id<>ALL(target_ids)
        )
    );
    UPDATE projects SET lifecycle_status='archived',archived_at=COALESCE(archived_at,now()),updated_at=now()
    WHERE tenant_id=tenant AND id=ANY(target_ids) AND id<>protected_id;

    INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,metadata)
    SELECT tenant,actor,'pilot.demo_project_archived','project',project_id,
      jsonb_build_object('cleanupKey','pilot-demo-projects-v1','protectedProjectId',protected_id)
    FROM unnest(target_ids) project_id
    WHERE NOT EXISTS (
      SELECT 1 FROM audit_log existing
      WHERE existing.tenant_id=tenant AND existing.action='pilot.demo_project_archived'
        AND existing.entity_id=project_id AND existing.metadata->>'cleanupKey'='pilot-demo-projects-v1'
    );
    INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    SELECT tenant,'project',project_id,'project.archived.v1',
      jsonb_build_object('projectId',project_id,'reason','pilot_demo_cleanup','cleanupKey','pilot-demo-projects-v1')
    FROM unnest(target_ids) project_id
    WHERE NOT EXISTS (
      SELECT 1 FROM outbox_events existing
      WHERE existing.tenant_id=tenant AND existing.aggregate_id=project_id
        AND existing.event_type='project.archived.v1'
        AND existing.payload->>'cleanupKey'='pilot-demo-projects-v1'
    );
  END LOOP;
END $$;

COMMIT;
