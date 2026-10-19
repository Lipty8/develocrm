BEGIN;

-- Contractual plans belong to the exact business version. Obligations continue
-- to require a real due date; no fake date and no historical backfill.
ALTER TABLE contract_versions ADD COLUMN payment_terms_snapshot jsonb;
ALTER TABLE contract_versions ADD CONSTRAINT contract_payment_terms_object
  CHECK(payment_terms_snapshot IS NULL OR jsonb_typeof(payment_terms_snapshot)='object');
ALTER TABLE payment_obligations ADD COLUMN contract_version_id uuid,
  ADD COLUMN schedule_key text;
ALTER TABLE payment_obligations ADD CONSTRAINT payment_obligation_exact_contract_version_fk
  FOREIGN KEY(tenant_id,project_id,contract_id,contract_version_id)
  REFERENCES contract_versions(tenant_id,project_id,contract_id,id) ON DELETE RESTRICT;
ALTER TABLE payment_obligations ADD CONSTRAINT payment_obligation_schedule_shape CHECK(
  (contract_version_id IS NULL AND schedule_key IS NULL) OR
  (contract_version_id IS NOT NULL AND schedule_key IS NOT NULL AND schedule_key IN ('rs_fee','sbk_first','sbk_final')));
CREATE UNIQUE INDEX payment_obligation_schedule_uq ON payment_obligations(tenant_id,contract_id,schedule_key)
  WHERE schedule_key IS NOT NULL;

CREATE FUNCTION app.guard_contract_payment_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT payment_terms_snapshot INTO previous FROM contract_versions
      WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND contract_id=NEW.contract_id
        AND (NEW.based_on_version_id IS NULL OR id=NEW.based_on_version_id)
      ORDER BY version_number DESC LIMIT 1;
    IF NEW.payment_terms_snapshot IS NULL THEN NEW.payment_terms_snapshot:=previous; END IF;
    IF NEW.payment_terms_snapshot IS NOT NULL AND NEW.payment_terms_snapshot IS DISTINCT FROM previous
      AND current_setting('app.contract_payment_terms_command',true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'PAYMENT_TERMS_COMMAND_REQUIRED';
    END IF;
  ELSIF NEW.payment_terms_snapshot IS DISTINCT FROM OLD.payment_terms_snapshot THEN
    IF OLD.document_version_id IS NOT NULL OR OLD.version_status<>'working' OR OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'PAYMENT_TERMS_VERSION_IMMUTABLE';
    END IF;
    IF current_setting('app.contract_payment_terms_command',true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'PAYMENT_TERMS_COMMAND_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_version_payment_terms_guard BEFORE INSERT OR UPDATE ON contract_versions
  FOR EACH ROW EXECUTE FUNCTION app.guard_contract_payment_terms();

CREATE FUNCTION app.prepare_signature_payment_terms(p_tenant uuid,p_contract uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE;v contract_versions%ROWTYPE;actor_user uuid;buyer uuid;buyer_count integer;
  rs_id uuid;rs_count integer;fee numeric;paid numeric;first_amount numeric;final_amount numeric;plan jsonb;items jsonb;symbol text;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor
    AND user_id=app.current_user_id() AND status='active';
  IF c.id IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.manage') THEN
    RAISE EXCEPTION 'contract.manage permission required';
  END IF;
  IF c.current_status<>'draft' OR c.contract_type NOT IN ('rs','sbk') OR NOT EXISTS(
    SELECT 1 FROM sales_cases WHERE tenant_id=p_tenant AND id=c.sales_case_id AND status='active' AND closed_at IS NULL) THEN
    RAISE EXCEPTION 'PAYMENT_TERMS_REQUIRE_ACTIVE_DRAFT';
  END IF;
  SELECT * INTO v FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC LIMIT 1 FOR UPDATE;
  IF v.id IS NULL OR v.version_status<>'working' OR v.document_version_id IS NOT NULL OR v.locked_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND signature_status='signed') THEN
    RAISE EXCEPTION 'PAYMENT_TERMS_VERSION_IMMUTABLE';
  END IF;
  IF EXISTS(SELECT 1 FROM payment_obligations WHERE tenant_id=p_tenant AND contract_id=p_contract) THEN
    RAISE EXCEPTION 'PAYMENT_TERMS_ALREADY_MATERIALIZED';
  END IF;
  SELECT count(*),min(party_id::text)::uuid INTO buyer_count,buyer FROM contract_parties
    WHERE tenant_id=p_tenant AND contract_id=p_contract AND participant_role IN ('buyer','co_buyer') AND effective_to IS NULL;
  IF buyer_count<>1 THEN RAISE EXCEPTION 'PAYMENT_TERMS_REQUIRE_ONE_BUYER'; END IF;
  IF c.total_price_snapshot IS NULL OR c.total_price_snapshot<=0 THEN RAISE EXCEPTION 'PAYMENT_TERMS_PRICE_REQUIRED'; END IF;
  symbol:=regexp_replace(c.reference,'\D','','g');
  IF NULLIF(symbol,'') IS NULL THEN RAISE EXCEPTION 'PAYMENT_TERMS_REFERENCE_REQUIRED'; END IF;
  IF c.contract_type='rs' THEN
    fee:=c.reservation_fee_amount;
    IF fee IS NULL OR fee<=0 OR fee>c.total_price_snapshot THEN RAISE EXCEPTION 'PAYMENT_TERMS_FEE_REQUIRED'; END IF;
    paid:=0;
    items:=jsonb_build_array(jsonb_build_object('key','rs_fee','amount',fee::text,'anchor','effective_signature','days',3,'calendar','czech_working_days'));
  ELSE
    SELECT count(*),min(id::text)::uuid INTO rs_count,rs_id FROM contracts WHERE tenant_id=p_tenant AND project_id=c.project_id
      AND unit_id=c.unit_id AND sales_case_id=c.sales_case_id AND contract_type='rs' AND current_status='signed';
    IF rs_count<>1 THEN RAISE EXCEPTION 'PAYMENT_TERMS_SIGNED_RS_REQUIRED'; END IF;
    SELECT reservation_fee_amount INTO fee FROM contracts WHERE tenant_id=p_tenant AND id=rs_id;
    SELECT COALESCE(sum(app.payment_obligation_paid(p_tenant,id)),0) INTO paid FROM payment_obligations
      WHERE tenant_id=p_tenant AND contract_id=rs_id AND obligation_type='reservation_fee' AND cancelled_at IS NULL;
    IF fee IS NULL OR fee<=0 OR paid<>fee THEN RAISE EXCEPTION 'PAYMENT_TERMS_PAID_RS_MISMATCH'; END IF;
    first_amount:=round(c.total_price_snapshot*0.2,2);final_amount:=c.total_price_snapshot-first_amount-paid;
    IF first_amount<=0 OR final_amount<0 THEN RAISE EXCEPTION 'PAYMENT_TERMS_INCONSISTENT_INSTALLMENTS'; END IF;
    items:=jsonb_build_array(
      jsonb_build_object('key','sbk_first','amount',first_amount::text,'anchor','effective_signature','days',5,'calendar','czech_working_days'),
      jsonb_build_object('key','sbk_final','amount',final_amount::text,'anchor','notice_delivery','days',30,'calendar','calendar_days'));
  END IF;
  plan:=jsonb_build_object('version',1,'profile','dejvice-original-dob-full-v1','calendarPolicy','cz-2026-v1',
    'signatureAnchor','last_required_signature','contractType',c.contract_type,
    'totalPrice',c.total_price_snapshot::text,'reservationFee',fee::text,'paidReservationFee',paid::text,
    'precedingRsContractId',rs_id,'buyerPartyId',buyer,'variableSymbol',symbol,'rows',items);
  IF v.payment_terms_snapshot IS NOT DISTINCT FROM plan THEN RETURN plan; END IF;
  IF v.payment_terms_snapshot IS NOT NULL THEN RAISE EXCEPTION 'PAYMENT_TERMS_ALREADY_PREPARED'; END IF;
  PERFORM set_config('app.contract_payment_terms_command','on',true);
  UPDATE contract_versions SET payment_terms_snapshot=plan WHERE tenant_id=p_tenant AND id=v.id;
  PERFORM set_config('app.contract_payment_terms_command','off',true);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
    VALUES(p_tenant,actor_user,'contract.payment_terms_prepared','contract',p_contract,plan,
      jsonb_build_object('projectId',c.project_id,'unitId',c.unit_id,'versionId',v.id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'contract',p_contract,'contract.payment_terms_prepared.v1',jsonb_build_object('contractId',p_contract,'versionId',v.id,'projectId',c.project_id));
  RETURN plan;
END $$;

-- Calendar data generated from czech-working-days.ts, policy version 2026-v1.
-- MPSV Act 245/2000 sections 1-3 rechecked 2026-10-19. This is a pinned
-- calendar policy, not a prediction of future legislation. Never alter an
-- applied policy: future legal changes require a new version/migration.
CREATE FUNCTION app.contract_working_day_2026_v1(p_day date) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_day IS NULL OR p_day NOT BETWEEN DATE '2016-01-01' AND DATE '2099-12-31' THEN RAISE EXCEPTION 'unsupported_contract_calendar_year'; END IF;
  RETURN extract(isodow FROM p_day)<=5 AND NOT p_day=ANY(ARRAY['2016-01-01','2016-03-25','2016-03-28','2016-07-05','2016-07-06','2016-09-28','2016-10-28','2016-11-17','2016-12-26','2017-04-14','2017-04-17','2017-05-01','2017-05-08','2017-07-05','2017-07-06','2017-09-28','2017-11-17','2017-12-25','2017-12-26','2018-01-01','2018-03-30','2018-04-02','2018-05-01','2018-05-08','2018-07-05','2018-07-06','2018-09-28','2018-12-24','2018-12-25','2018-12-26','2019-01-01','2019-04-19','2019-04-22','2019-05-01','2019-05-08','2019-07-05','2019-10-28','2019-12-24','2019-12-25','2019-12-26','2020-01-01','2020-04-10','2020-04-13','2020-05-01','2020-05-08','2020-07-06','2020-09-28','2020-10-28','2020-11-17','2020-12-24','2020-12-25','2021-01-01','2021-04-02','2021-04-05','2021-07-05','2021-07-06','2021-09-28','2021-10-28','2021-11-17','2021-12-24','2022-04-15','2022-04-18','2022-07-05','2022-07-06','2022-09-28','2022-10-28','2022-11-17','2022-12-26','2023-04-07','2023-04-10','2023-05-01','2023-05-08','2023-07-05','2023-07-06','2023-09-28','2023-11-17','2023-12-25','2023-12-26','2024-01-01','2024-03-29','2024-04-01','2024-05-01','2024-05-08','2024-07-05','2024-10-28','2024-12-24','2024-12-25','2024-12-26','2025-01-01','2025-04-18','2025-04-21','2025-05-01','2025-05-08','2025-10-28','2025-11-17','2025-12-24','2025-12-25','2025-12-26','2026-01-01','2026-04-03','2026-04-06','2026-05-01','2026-05-08','2026-07-06','2026-09-28','2026-10-28','2026-11-17','2026-12-24','2026-12-25','2027-01-01','2027-03-26','2027-03-29','2027-07-05','2027-07-06','2027-09-28','2027-10-28','2027-11-17','2027-12-24','2028-04-14','2028-04-17','2028-05-01','2028-05-08','2028-07-05','2028-07-06','2028-09-28','2028-11-17','2028-12-25','2028-12-26','2029-01-01','2029-03-30','2029-04-02','2029-05-01','2029-05-08','2029-07-05','2029-07-06','2029-09-28','2029-12-24','2029-12-25','2029-12-26','2030-01-01','2030-04-19','2030-04-22','2030-05-01','2030-05-08','2030-07-05','2030-10-28','2030-12-24','2030-12-25','2030-12-26','2031-01-01','2031-04-11','2031-04-14','2031-05-01','2031-05-08','2031-10-28','2031-11-17','2031-12-24','2031-12-25','2031-12-26','2032-01-01','2032-03-26','2032-03-29','2032-07-05','2032-07-06','2032-09-28','2032-10-28','2032-11-17','2032-12-24','2033-04-15','2033-04-18','2033-07-05','2033-07-06','2033-09-28','2033-10-28','2033-11-17','2033-12-26','2034-04-07','2034-04-10','2034-05-01','2034-05-08','2034-07-05','2034-07-06','2034-09-28','2034-11-17','2034-12-25','2034-12-26','2035-01-01','2035-03-23','2035-03-26','2035-05-01','2035-05-08','2035-07-05','2035-07-06','2035-09-28','2035-12-24','2035-12-25','2035-12-26','2036-01-01','2036-04-11','2036-04-14','2036-05-01','2036-05-08','2036-10-28','2036-11-17','2036-12-24','2036-12-25','2036-12-26','2037-01-01','2037-04-03','2037-04-06','2037-05-01','2037-05-08','2037-07-06','2037-09-28','2037-10-28','2037-11-17','2037-12-24','2037-12-25','2038-01-01','2038-04-23','2038-04-26','2038-07-05','2038-07-06','2038-09-28','2038-10-28','2038-11-17','2038-12-24','2039-04-08','2039-04-11','2039-07-05','2039-07-06','2039-09-28','2039-10-28','2039-11-17','2039-12-26','2040-03-30','2040-04-02','2040-05-01','2040-05-08','2040-07-05','2040-07-06','2040-09-28','2040-12-24','2040-12-25','2040-12-26','2041-01-01','2041-04-19','2041-04-22','2041-05-01','2041-05-08','2041-07-05','2041-10-28','2041-12-24','2041-12-25','2041-12-26','2042-01-01','2042-04-04','2042-04-07','2042-05-01','2042-05-08','2042-10-28','2042-11-17','2042-12-24','2042-12-25','2042-12-26','2043-01-01','2043-03-27','2043-03-30','2043-05-01','2043-05-08','2043-07-06','2043-09-28','2043-10-28','2043-11-17','2043-12-24','2043-12-25','2044-01-01','2044-04-15','2044-04-18','2044-07-05','2044-07-06','2044-09-28','2044-10-28','2044-11-17','2044-12-26','2045-04-07','2045-04-10','2045-05-01','2045-05-08','2045-07-05','2045-07-06','2045-09-28','2045-11-17','2045-12-25','2045-12-26','2046-01-01','2046-03-23','2046-03-26','2046-05-01','2046-05-08','2046-07-05','2046-07-06','2046-09-28','2046-12-24','2046-12-25','2046-12-26','2047-01-01','2047-04-12','2047-04-15','2047-05-01','2047-05-08','2047-07-05','2047-10-28','2047-12-24','2047-12-25','2047-12-26','2048-01-01','2048-04-03','2048-04-06','2048-05-01','2048-05-08','2048-07-06','2048-09-28','2048-10-28','2048-11-17','2048-12-24','2048-12-25','2049-01-01','2049-04-16','2049-04-19','2049-07-05','2049-07-06','2049-09-28','2049-10-28','2049-11-17','2049-12-24','2050-04-08','2050-04-11','2050-07-05','2050-07-06','2050-09-28','2050-10-28','2050-11-17','2050-12-26','2051-03-31','2051-04-03','2051-05-01','2051-05-08','2051-07-05','2051-07-06','2051-09-28','2051-11-17','2051-12-25','2051-12-26','2052-01-01','2052-04-19','2052-04-22','2052-05-01','2052-05-08','2052-07-05','2052-10-28','2052-12-24','2052-12-25','2052-12-26','2053-01-01','2053-04-04','2053-04-07','2053-05-01','2053-05-08','2053-10-28','2053-11-17','2053-12-24','2053-12-25','2053-12-26','2054-01-01','2054-03-27','2054-03-30','2054-05-01','2054-05-08','2054-07-06','2054-09-28','2054-10-28','2054-11-17','2054-12-24','2054-12-25','2055-01-01','2055-04-16','2055-04-19','2055-07-05','2055-07-06','2055-09-28','2055-10-28','2055-11-17','2055-12-24','2056-03-31','2056-04-03','2056-05-01','2056-05-08','2056-07-05','2056-07-06','2056-09-28','2056-11-17','2056-12-25','2056-12-26','2057-01-01','2057-04-20','2057-04-23','2057-05-01','2057-05-08','2057-07-05','2057-07-06','2057-09-28','2057-12-24','2057-12-25','2057-12-26','2058-01-01','2058-04-12','2058-04-15','2058-05-01','2058-05-08','2058-07-05','2058-10-28','2058-12-24','2058-12-25','2058-12-26','2059-01-01','2059-03-28','2059-03-31','2059-05-01','2059-05-08','2059-10-28','2059-11-17','2059-12-24','2059-12-25','2059-12-26','2060-01-01','2060-04-16','2060-04-19','2060-07-05','2060-07-06','2060-09-28','2060-10-28','2060-11-17','2060-12-24','2061-04-08','2061-04-11','2061-07-05','2061-07-06','2061-09-28','2061-10-28','2061-11-17','2061-12-26','2062-03-24','2062-03-27','2062-05-01','2062-05-08','2062-07-05','2062-07-06','2062-09-28','2062-11-17','2062-12-25','2062-12-26','2063-01-01','2063-04-13','2063-04-16','2063-05-01','2063-05-08','2063-07-05','2063-07-06','2063-09-28','2063-12-24','2063-12-25','2063-12-26','2064-01-01','2064-04-04','2064-04-07','2064-05-01','2064-05-08','2064-10-28','2064-11-17','2064-12-24','2064-12-25','2064-12-26','2065-01-01','2065-03-27','2065-03-30','2065-05-01','2065-05-08','2065-07-06','2065-09-28','2065-10-28','2065-11-17','2065-12-24','2065-12-25','2066-01-01','2066-04-09','2066-04-12','2066-07-05','2066-07-06','2066-09-28','2066-10-28','2066-11-17','2066-12-24','2067-04-01','2067-04-04','2067-07-05','2067-07-06','2067-09-28','2067-10-28','2067-11-17','2067-12-26','2068-04-20','2068-04-23','2068-05-01','2068-05-08','2068-07-05','2068-07-06','2068-09-28','2068-12-24','2068-12-25','2068-12-26','2069-01-01','2069-04-12','2069-04-15','2069-05-01','2069-05-08','2069-07-05','2069-10-28','2069-12-24','2069-12-25','2069-12-26','2070-01-01','2070-03-28','2070-03-31','2070-05-01','2070-05-08','2070-10-28','2070-11-17','2070-12-24','2070-12-25','2070-12-26','2071-01-01','2071-04-17','2071-04-20','2071-05-01','2071-05-08','2071-07-06','2071-09-28','2071-10-28','2071-11-17','2071-12-24','2071-12-25','2072-01-01','2072-04-08','2072-04-11','2072-07-05','2072-07-06','2072-09-28','2072-10-28','2072-11-17','2072-12-26','2073-03-24','2073-03-27','2073-05-01','2073-05-08','2073-07-05','2073-07-06','2073-09-28','2073-11-17','2073-12-25','2073-12-26','2074-01-01','2074-04-13','2074-04-16','2074-05-01','2074-05-08','2074-07-05','2074-07-06','2074-09-28','2074-12-24','2074-12-25','2074-12-26','2075-01-01','2075-04-05','2075-04-08','2075-05-01','2075-05-08','2075-07-05','2075-10-28','2075-12-24','2075-12-25','2075-12-26','2076-01-01','2076-04-17','2076-04-20','2076-05-01','2076-05-08','2076-07-06','2076-09-28','2076-10-28','2076-11-17','2076-12-24','2076-12-25','2077-01-01','2077-04-09','2077-04-12','2077-07-05','2077-07-06','2077-09-28','2077-10-28','2077-11-17','2077-12-24','2078-04-01','2078-04-04','2078-07-05','2078-07-06','2078-09-28','2078-10-28','2078-11-17','2078-12-26','2079-04-21','2079-04-24','2079-05-01','2079-05-08','2079-07-05','2079-07-06','2079-09-28','2079-11-17','2079-12-25','2079-12-26','2080-01-01','2080-04-05','2080-04-08','2080-05-01','2080-05-08','2080-07-05','2080-10-28','2080-12-24','2080-12-25','2080-12-26','2081-01-01','2081-03-28','2081-03-31','2081-05-01','2081-05-08','2081-10-28','2081-11-17','2081-12-24','2081-12-25','2081-12-26','2082-01-01','2082-04-17','2082-04-20','2082-05-01','2082-05-08','2082-07-06','2082-09-28','2082-10-28','2082-11-17','2082-12-24','2082-12-25','2083-01-01','2083-04-02','2083-04-05','2083-07-05','2083-07-06','2083-09-28','2083-10-28','2083-11-17','2083-12-24','2084-03-24','2084-03-27','2084-05-01','2084-05-08','2084-07-05','2084-07-06','2084-09-28','2084-11-17','2084-12-25','2084-12-26','2085-01-01','2085-04-13','2085-04-16','2085-05-01','2085-05-08','2085-07-05','2085-07-06','2085-09-28','2085-12-24','2085-12-25','2085-12-26','2086-01-01','2086-03-29','2086-04-01','2086-05-01','2086-05-08','2086-07-05','2086-10-28','2086-12-24','2086-12-25','2086-12-26','2087-01-01','2087-04-18','2087-04-21','2087-05-01','2087-05-08','2087-10-28','2087-11-17','2087-12-24','2087-12-25','2087-12-26','2088-01-01','2088-04-09','2088-04-12','2088-07-05','2088-07-06','2088-09-28','2088-10-28','2088-11-17','2088-12-24','2089-04-01','2089-04-04','2089-07-05','2089-07-06','2089-09-28','2089-10-28','2089-11-17','2089-12-26','2090-04-14','2090-04-17','2090-05-01','2090-05-08','2090-07-05','2090-07-06','2090-09-28','2090-11-17','2090-12-25','2090-12-26','2091-01-01','2091-04-06','2091-04-09','2091-05-01','2091-05-08','2091-07-05','2091-07-06','2091-09-28','2091-12-24','2091-12-25','2091-12-26','2092-01-01','2092-03-28','2092-03-31','2092-05-01','2092-05-08','2092-10-28','2092-11-17','2092-12-24','2092-12-25','2092-12-26','2093-01-01','2093-04-10','2093-04-13','2093-05-01','2093-05-08','2093-07-06','2093-09-28','2093-10-28','2093-11-17','2093-12-24','2093-12-25','2094-01-01','2094-04-02','2094-04-05','2094-07-05','2094-07-06','2094-09-28','2094-10-28','2094-11-17','2094-12-24','2095-04-22','2095-04-25','2095-07-05','2095-07-06','2095-09-28','2095-10-28','2095-11-17','2095-12-26','2096-04-13','2096-04-16','2096-05-01','2096-05-08','2096-07-05','2096-07-06','2096-09-28','2096-12-24','2096-12-25','2096-12-26','2097-01-01','2097-03-29','2097-04-01','2097-05-01','2097-05-08','2097-07-05','2097-10-28','2097-12-24','2097-12-25','2097-12-26','2098-01-01','2098-04-18','2098-04-21','2098-05-01','2098-05-08','2098-10-28','2098-11-17','2098-12-24','2098-12-25','2098-12-26','2099-01-01','2099-04-10','2099-04-13','2099-05-01','2099-05-08','2099-07-06','2099-09-28','2099-10-28','2099-11-17','2099-12-24','2099-12-25']::date[]);
END $$;
CREATE FUNCTION app.contract_add_working_days_2026_v1(p_day date,p_days integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE cursor_day date:=p_day;remaining integer:=p_days;
BEGIN
  PERFORM app.contract_working_day_2026_v1(p_day);
  IF p_days IS NULL OR p_days<0 OR p_days>366 THEN RAISE EXCEPTION 'invalid_working_day_count'; END IF;
  WHILE remaining>0 LOOP
    cursor_day:=cursor_day+1;
    IF app.contract_working_day_2026_v1(cursor_day) THEN remaining:=remaining-1; END IF;
  END LOOP;
  RETURN cursor_day;
END $$;



CREATE FUNCTION app.create_contract_with_signature_payments(
  p_tenant uuid,p_case uuid,p_type text,p_reference text,p_title text,p_actor uuid,p_key text,p_calculation text,p_input numeric
) RETURNS TABLE(contract_id uuid,version_id uuid,payment_obligation_id uuid,payment_amount numeric)
LANGUAGE plpgsql AS $$
DECLARE c contracts%ROWTYPE;created uuid;v uuid;project uuid;actor_user uuid;fee numeric;plan jsonb;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  IF p_type NOT IN ('rs','sbk') OR p_type IS NULL OR length(btrim(COALESCE(p_key,''))) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'PAYMENT_TERMS_INVALID_REQUEST';
  END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case));
  SELECT project_id INTO project FROM sales_cases WHERE tenant_id=p_tenant AND id=p_case AND status='active' AND closed_at IS NULL FOR UPDATE;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND user_id=app.current_user_id() AND status='active';
  IF project IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,project,'contract.manage') THEN
    RAISE EXCEPTION 'contract.manage permission required';
  END IF;
  IF p_type='rs' AND (p_calculation IS NULL OR p_calculation NOT IN ('fixed','percentage') OR p_input IS NULL OR p_input<=0) THEN
    RAISE EXCEPTION 'PAYMENT_TERMS_FEE_REQUIRED';
  END IF;
  IF p_type='sbk' AND (p_calculation IS NOT NULL OR p_input IS NOT NULL) THEN RAISE EXCEPTION 'PAYMENT_TERMS_SBK_IS_DERIVED'; END IF;
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND idempotency_key=btrim(p_key);
  IF c.id IS NOT NULL THEN
    SELECT cv.id,cv.payment_terms_snapshot INTO v,plan FROM contract_versions cv WHERE cv.tenant_id=p_tenant AND cv.contract_id=c.id ORDER BY cv.version_number LIMIT 1;
    fee:=CASE p_calculation WHEN 'fixed' THEN round(p_input,2) WHEN 'percentage' THEN round(c.total_price_snapshot*p_input/100,2) ELSE NULL END;
    IF c.sales_case_id<>p_case OR c.contract_type<>p_type OR plan IS NULL OR (p_type='rs' AND fee IS DISTINCT FROM (plan->>'reservationFee')::numeric) THEN
      RAISE EXCEPTION 'PAYMENT_TERMS_IDEMPOTENCY_MISMATCH';
    END IF;
    RETURN QUERY SELECT c.id,v,NULL::uuid,(plan->'rows'->0->>'amount')::numeric;RETURN;
  END IF;
  created:=app.create_contract(p_tenant,p_case,p_type,p_reference,p_title,p_actor,NULL);
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=created;
  IF p_type='rs' THEN
    fee:=CASE p_calculation WHEN 'fixed' THEN round(p_input,2) ELSE round(c.total_price_snapshot*p_input/100,2) END;
    IF fee IS NULL OR fee<=0 OR fee>c.total_price_snapshot THEN RAISE EXCEPTION 'PAYMENT_TERMS_FEE_REQUIRED'; END IF;
  END IF;
  UPDATE contracts SET idempotency_key=btrim(p_key),reservation_fee_amount=CASE WHEN p_type='rs' THEN fee ELSE reservation_fee_amount END
    WHERE tenant_id=p_tenant AND id=created;
  plan:=app.prepare_signature_payment_terms(p_tenant,created,p_actor);
  SELECT cv.id INTO v FROM contract_versions cv WHERE cv.tenant_id=p_tenant AND cv.contract_id=created AND cv.version_number=1;
  RETURN QUERY SELECT created,v,NULL::uuid,(plan->'rows'->0->>'amount')::numeric;
END $$;

CREATE FUNCTION app.guard_scheduled_payment_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.schedule_key IS NOT NULL AND
    ROW(NEW.tenant_id,NEW.project_id,NEW.unit_id,NEW.sales_case_id,NEW.contract_id,NEW.party_id,NEW.contract_version_id,NEW.schedule_key,NEW.amount,NEW.currency,NEW.original_due_at)
      IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.unit_id,OLD.sales_case_id,OLD.contract_id,OLD.party_id,OLD.contract_version_id,OLD.schedule_key,OLD.amount,OLD.currency,OLD.original_due_at) THEN
    RAISE EXCEPTION 'PAYMENT_TERMS_OBLIGATION_IMMUTABLE';
  END IF;
  IF (TG_OP='INSERT' AND NEW.schedule_key IS NOT NULL) OR
    (TG_OP='UPDATE' AND OLD.schedule_key IS NULL AND NEW.schedule_key IS NOT NULL) THEN
    IF current_setting('app.signature_payment_materialization',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'PAYMENT_TERMS_COMMAND_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_obligation_schedule_guard BEFORE INSERT OR UPDATE ON payment_obligations
  FOR EACH ROW EXECUTE FUNCTION app.guard_scheduled_payment_obligation();

CREATE FUNCTION app.materialize_signature_payment(
  p_tenant uuid,p_contract uuid,p_version uuid,p_schedule_key text,p_anchor_day date,p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE;v contract_versions%ROWTYPE;existing payment_obligations%ROWTYPE;item jsonb;actor_user uuid;rs contracts%ROWTYPE;paid_rs numeric;
  expected_day date;due_day date;due_time timestamptz;amount_value numeric;buyer uuid;obligation_id uuid;label_text text;type_text text;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor AND user_id=app.current_user_id() AND status='active';
  IF c.id IS NULL OR actor_user IS NULL OR NOT (app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.sign')
    OR (p_schedule_key='sbk_final' AND app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.manage'))) THEN
    RAISE EXCEPTION 'contract.sign permission required';
  END IF;
  SELECT * INTO v FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract AND id=p_version FOR UPDATE;
  IF c.current_status<>'signed' OR v.version_status IS DISTINCT FROM 'signed' OR v.payment_terms_snapshot IS NULL
    OR v.payment_terms_snapshot->>'profile' IS DISTINCT FROM 'dejvice-original-dob-full-v1' THEN RAISE EXCEPTION 'PAYMENT_TERMS_SIGNED_VERSION_REQUIRED'; END IF;
  IF (v.payment_terms_snapshot->>'totalPrice')::numeric IS DISTINCT FROM c.total_price_snapshot
    OR v.payment_terms_snapshot->>'contractType' IS DISTINCT FROM c.contract_type THEN RAISE EXCEPTION 'PAYMENT_TERMS_SNAPSHOT_MISMATCH'; END IF;
  IF v.payment_terms_snapshot->>'calendarPolicy' IS DISTINCT FROM 'cz-2026-v1' THEN RAISE EXCEPTION 'PAYMENT_TERMS_INVALID_CALENDAR'; END IF;
  SELECT value INTO item FROM jsonb_array_elements(v.payment_terms_snapshot->'rows') WHERE value->>'key'=p_schedule_key;
  IF item IS NULL THEN RAISE EXCEPTION 'PAYMENT_TERMS_SCHEDULE_NOT_FOUND'; END IF;
  IF item->>'anchor'='effective_signature' THEN
    IF EXISTS(SELECT 1 FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required
      AND (signature_status<>'signed' OR signed_version_id IS DISTINCT FROM p_version)) OR NOT EXISTS(
      SELECT 1 FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required) THEN RAISE EXCEPTION 'PAYMENT_TERMS_ALL_SIGNATURES_REQUIRED'; END IF;
    -- Business decision approved 2026-10-19: the last required signature.
    IF v.payment_terms_snapshot->>'signatureAnchor' IS DISTINCT FROM 'last_required_signature' THEN
      RAISE EXCEPTION 'PAYMENT_TERMS_SIGNATURE_ANCHOR_UNCONFIRMED'; END IF;
    IF (SELECT max(signed_at) FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required)
      IS DISTINCT FROM c.signed_at THEN RAISE EXCEPTION 'PAYMENT_TERMS_SIGNATURE_ANCHOR_MISMATCH'; END IF;
    expected_day:=(c.signed_at AT TIME ZONE 'Europe/Prague')::date;
  ELSIF item->>'anchor'='notice_delivery' THEN
    SELECT (payload->>'deliveredOn')::date INTO expected_day FROM payment_events WHERE tenant_id=p_tenant AND project_id=c.project_id
      AND event_type='contract.final_notice_delivered' AND payload->>'contractVersionId'=p_version::text;
  ELSE RAISE EXCEPTION 'PAYMENT_TERMS_INVALID_ANCHOR'; END IF;
  IF expected_day IS NULL OR p_anchor_day IS DISTINCT FROM expected_day THEN RAISE EXCEPTION 'PAYMENT_TERMS_ANCHOR_EVIDENCE_REQUIRED'; END IF;
  PERFORM app.contract_working_day_2026_v1(p_anchor_day);
  due_day:=CASE item->>'calendar' WHEN 'czech_working_days' THEN app.contract_add_working_days_2026_v1(p_anchor_day,(item->>'days')::integer)
    WHEN 'calendar_days' THEN p_anchor_day+(item->>'days')::integer ELSE NULL END;
  IF due_day IS NULL THEN RAISE EXCEPTION 'PAYMENT_TERMS_INVALID_CALENDAR'; END IF;
  PERFORM app.contract_working_day_2026_v1(due_day);
  due_time:=((due_day+1)::timestamp AT TIME ZONE 'Europe/Prague')-interval '1 microsecond';
  amount_value:=(item->>'amount')::numeric;buyer:=(v.payment_terms_snapshot->>'buyerPartyId')::uuid;
  SELECT * INTO existing FROM payment_obligations WHERE tenant_id=p_tenant AND contract_id=p_contract AND schedule_key=p_schedule_key FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    IF existing.contract_version_id<>p_version OR existing.amount<>amount_value OR existing.original_due_at<>due_time THEN
      RAISE EXCEPTION 'PAYMENT_TERMS_OBLIGATION_MISMATCH';
    END IF;
    RETURN existing.id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM sales_cases WHERE tenant_id=p_tenant AND id=c.sales_case_id AND status='active' AND closed_at IS NULL)
    OR (SELECT count(*) FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract
      AND participant_role IN ('buyer','co_buyer') AND effective_to IS NULL)<>1
    OR NOT EXISTS(SELECT 1 FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND party_id=buyer
      AND participant_role IN ('buyer','co_buyer') AND effective_to IS NULL) THEN RAISE EXCEPTION 'PAYMENT_TERMS_CONTEXT_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM payment_obligations WHERE tenant_id=p_tenant AND contract_id=p_contract AND schedule_key IS NULL) THEN
    RAISE EXCEPTION 'PAYMENT_TERMS_ALREADY_MATERIALIZED';
  END IF;
  IF c.contract_type='sbk' THEN
    SELECT * INTO rs FROM contracts WHERE tenant_id=p_tenant AND project_id=c.project_id AND sales_case_id=c.sales_case_id
      AND unit_id=c.unit_id AND id=(v.payment_terms_snapshot->>'precedingRsContractId')::uuid AND contract_type='rs' AND current_status='signed';
    IF rs.id IS NULL OR rs.reservation_fee_amount IS DISTINCT FROM (v.payment_terms_snapshot->>'reservationFee')::numeric THEN
      RAISE EXCEPTION 'PAYMENT_TERMS_SIGNED_RS_REQUIRED';
    END IF;
    SELECT COALESCE(sum(app.payment_obligation_paid(p_tenant,id)),0) INTO paid_rs FROM payment_obligations
      WHERE tenant_id=p_tenant AND contract_id=rs.id AND obligation_type='reservation_fee' AND cancelled_at IS NULL;
    IF paid_rs IS DISTINCT FROM (v.payment_terms_snapshot->>'paidReservationFee')::numeric THEN RAISE EXCEPTION 'PAYMENT_TERMS_PAID_RS_MISMATCH'; END IF;
  END IF;
  IF amount_value=0 AND p_schedule_key='sbk_final' THEN RETURN NULL; END IF;
  IF amount_value IS NULL OR amount_value<=0 THEN RAISE EXCEPTION 'PAYMENT_TERMS_INVALID_AMOUNT'; END IF;
  IF c.contract_type='rs' AND c.reservation_fee_amount IS DISTINCT FROM amount_value THEN RAISE EXCEPTION 'PAYMENT_TERMS_SNAPSHOT_MISMATCH'; END IF;
  label_text:=CASE p_schedule_key WHEN 'rs_fee' THEN 'Rezervační poplatek' WHEN 'sbk_first' THEN 'První splátka dle SBK' ELSE 'Doplatek dle SBK' END;
  type_text:=CASE p_schedule_key WHEN 'rs_fee' THEN 'reservation_fee' WHEN 'sbk_first' THEN 'purchase_installment' ELSE 'purchase_balance' END;
  PERFORM set_config('app.signature_payment_materialization','on',true);
  INSERT INTO payment_obligations(tenant_id,project_id,unit_id,party_id,sales_case_id,contract_id,obligation_type,label,amount,due_at,variable_symbol,idempotency_key,created_by_membership_id,contract_version_id,schedule_key)
    VALUES(p_tenant,c.project_id,c.unit_id,buyer,c.sales_case_id,p_contract,type_text,label_text,amount_value,due_time,
      v.payment_terms_snapshot->>'variableSymbol','contract-schedule:'||p_contract||':'||p_schedule_key,p_actor,p_version,p_schedule_key)
    RETURNING id INTO obligation_id;
  PERFORM set_config('app.signature_payment_materialization','off',true);
  INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id)
    VALUES(p_tenant,c.project_id,obligation_id,'obligation.created',jsonb_build_object('amount',amount_value,'source','contract_signature_terms','contractVersionId',p_version,'scheduleKey',p_schedule_key,'anchorDay',p_anchor_day,'dueOn',due_day),p_actor);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
    VALUES(p_tenant,actor_user,'payment.obligation_created','payment_obligation',obligation_id,
      jsonb_build_object('amount',amount_value,'dueAt',due_time,'source','contract_signature_terms','contractVersionId',p_version,'scheduleKey',p_schedule_key),
      jsonb_build_object('projectId',c.project_id,'unitId',c.unit_id,'contractId',p_contract,'salesCaseId',c.sales_case_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'payment_obligation',obligation_id,'payment.obligation_created.v1',jsonb_build_object('obligationId',obligation_id,'contractId',p_contract,'contractVersionId',p_version,'scheduleKey',p_schedule_key,'amount',amount_value,'dueOn',due_day));
  RETURN obligation_id;
END $$;

CREATE OR REPLACE FUNCTION app.ensure_rs_reservation_fee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_party uuid;fee_amount numeric;fee_days integer;obligation_id uuid;actor uuid;planned contract_versions%ROWTYPE;signer uuid;
BEGIN
  IF NEW.current_status='signed' AND OLD.current_status IS DISTINCT FROM 'signed' THEN
    SELECT * INTO planned FROM contract_versions WHERE tenant_id=NEW.tenant_id AND contract_id=NEW.id
      AND version_status='signed' ORDER BY version_number DESC LIMIT 1;
    IF planned.payment_terms_snapshot IS NOT NULL THEN
      SELECT id INTO signer FROM tenant_memberships WHERE tenant_id=NEW.tenant_id AND user_id=app.current_user_id() AND status='active';
      PERFORM app.materialize_signature_payment(NEW.tenant_id,NEW.id,planned.id,
        CASE NEW.contract_type WHEN 'rs' THEN 'rs_fee' WHEN 'sbk' THEN 'sbk_first' ELSE NULL END,
        (NEW.signed_at AT TIME ZONE 'Europe/Prague')::date,signer);
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.current_status='signed' AND OLD.current_status IS DISTINCT FROM 'signed' AND NEW.contract_type='rs'
     AND NOT EXISTS(SELECT 1 FROM payment_obligations obligation WHERE obligation.tenant_id=NEW.tenant_id AND obligation.contract_id=NEW.id AND obligation.obligation_type='reservation_fee' AND obligation.cancelled_at IS NULL) THEN
    SELECT party_id INTO case_party FROM sales_case_parties WHERE tenant_id=NEW.tenant_id AND sales_case_id=NEW.sales_case_id AND participant_role IN ('buyer','co_buyer') ORDER BY is_primary DESC,joined_at LIMIT 1;
    fee_amount:=COALESCE(NEW.reservation_fee_amount,250000);fee_days:=NEW.reservation_fee_due_days;
    SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=NEW.tenant_id AND id=NEW.created_by_membership_id;
    INSERT INTO payment_obligations(tenant_id,project_id,unit_id,party_id,sales_case_id,contract_id,obligation_type,label,amount,due_at,variable_symbol,idempotency_key,created_by_membership_id)
    VALUES(NEW.tenant_id,NEW.project_id,NEW.unit_id,case_party,NEW.sales_case_id,NEW.id,'reservation_fee','Rezervační poplatek',fee_amount,now()+make_interval(days=>fee_days),regexp_replace(NEW.reference,'\D','','g'),'rs-fee:'||NEW.id,NEW.created_by_membership_id)
    ON CONFLICT (tenant_id,idempotency_key) DO NOTHING RETURNING id INTO obligation_id;
    IF obligation_id IS NOT NULL THEN
      INSERT INTO payment_events(tenant_id,project_id,obligation_id,event_type,payload,recorded_by_membership_id) VALUES(NEW.tenant_id,NEW.project_id,obligation_id,'obligation.created',jsonb_build_object('amount',fee_amount,'source','signed_rs'),NEW.created_by_membership_id);
      INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata) VALUES(NEW.tenant_id,actor,'payment.obligation_created','payment_obligation',obligation_id,jsonb_build_object('amount',fee_amount,'contractId',NEW.id),jsonb_build_object('projectId',NEW.project_id,'unitId',NEW.unit_id,'salesCaseId',NEW.sales_case_id));
      INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES(NEW.tenant_id,'payment_obligation',obligation_id,'payment.obligation_created.v1',jsonb_build_object('obligationId',obligation_id,'unitId',NEW.unit_id,'contractId',NEW.id,'amount',fee_amount));
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Delivery is evidenced separately from signature. It does not invent a
-- calendar date for an undelivered final-payment notice.
CREATE UNIQUE INDEX contract_final_notice_version_uq ON payment_events(tenant_id,(payload->>'contractVersionId'))
  WHERE event_type='contract.final_notice_delivered';

CREATE FUNCTION app.record_sbk_final_notice(
  p_tenant uuid,p_contract uuid,p_version uuid,p_delivered_on date,p_evidence_version uuid,p_actor uuid,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE;v contract_versions%ROWTYPE;evidence document_versions%ROWTYPE;
  actor_user uuid;previous payment_events%ROWTYPE;obligation uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor_user FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor
    AND user_id=app.current_user_id() AND status='active';
  IF c.id IS NULL OR actor_user IS NULL OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.manage') THEN
    RAISE EXCEPTION 'contract.manage permission required';
  END IF;
  IF length(btrim(COALESCE(p_key,''))) NOT BETWEEN 8 AND 160 THEN RAISE EXCEPTION 'PAYMENT_TERMS_INVALID_REQUEST'; END IF;
  SELECT * INTO v FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract AND id=p_version FOR UPDATE;
  IF c.contract_type<>'sbk' OR c.current_status<>'signed' OR v.version_status IS DISTINCT FROM 'signed'
    OR v.payment_terms_snapshot IS NULL THEN RAISE EXCEPTION 'PAYMENT_TERMS_SIGNED_VERSION_REQUIRED'; END IF;
  IF p_delivered_on IS NULL OR p_delivered_on<(c.signed_at AT TIME ZONE 'Europe/Prague')::date
    OR p_delivered_on>(now() AT TIME ZONE 'Europe/Prague')::date THEN RAISE EXCEPTION 'PAYMENT_TERMS_INVALID_DELIVERY_DATE'; END IF;
  SELECT * INTO previous FROM payment_events WHERE tenant_id=p_tenant AND project_id=c.project_id
    AND event_type='contract.final_notice_delivered' AND payload->>'contractVersionId'=p_version::text;
  IF previous.id IS NOT NULL THEN
    IF previous.payload->>'deliveredOn' IS DISTINCT FROM p_delivered_on::text
      OR previous.payload->>'evidenceDocumentVersionId' IS DISTINCT FROM p_evidence_version::text
      OR previous.payload->>'idempotencyKey' IS DISTINCT FROM btrim(p_key) THEN RAISE EXCEPTION 'PAYMENT_TERMS_DELIVERY_ALREADY_RECORDED'; END IF;
    RETURN app.materialize_signature_payment(p_tenant,p_contract,p_version,'sbk_final',p_delivered_on,p_actor);
  END IF;
  SELECT dv.* INTO evidence FROM document_versions dv JOIN documents d ON d.tenant_id=dv.tenant_id AND d.id=dv.document_id
    WHERE dv.tenant_id=p_tenant AND dv.project_id=c.project_id AND dv.id=p_evidence_version
      AND dv.status_code IN ('ready','sent','signed') AND dv.content_hash~'^sha256:[a-f0-9]{64}$'
      AND NULLIF(dv.external_version_id,'') IS NOT NULL AND d.storage_provider='sharepoint' AND d.archived_at IS NULL
      AND EXISTS(SELECT 1 FROM contract_documents l WHERE l.tenant_id=p_tenant AND l.project_id=c.project_id AND l.contract_id=c.id AND l.document_id=d.id)
      AND EXISTS(SELECT 1 FROM sales_case_documents l WHERE l.tenant_id=p_tenant AND l.project_id=c.project_id AND l.sales_case_id=c.sales_case_id AND l.document_id=d.id)
      AND EXISTS(SELECT 1 FROM unit_documents l WHERE l.tenant_id=p_tenant AND l.project_id=c.project_id AND l.unit_id=c.unit_id AND l.document_id=d.id)
      AND EXISTS(SELECT 1 FROM document_upload_operations u WHERE u.tenant_id=p_tenant AND u.document_version_id=dv.id AND u.state='completed'
        AND u.content_hash=dv.content_hash AND u.graph_item_id=d.external_item_id AND u.graph_drive_id=d.external_drive_id);
  IF evidence.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_TERMS_DELIVERY_EVIDENCE_REQUIRED'; END IF;
  INSERT INTO payment_events(tenant_id,project_id,event_type,payload,recorded_by_membership_id)
    VALUES(p_tenant,c.project_id,'contract.final_notice_delivered',jsonb_build_object('contractId',p_contract,'contractVersionId',p_version,
      'deliveredOn',p_delivered_on,'evidenceDocumentVersionId',p_evidence_version,'idempotencyKey',btrim(p_key)),p_actor);
  obligation:=app.materialize_signature_payment(p_tenant,p_contract,p_version,'sbk_final',p_delivered_on,p_actor);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
    VALUES(p_tenant,actor_user,'contract.final_notice_delivered','contract',p_contract,
      jsonb_build_object('contractVersionId',p_version,'deliveredOn',p_delivered_on,'evidenceDocumentVersionId',p_evidence_version,'obligationId',obligation),
      jsonb_build_object('projectId',c.project_id,'unitId',c.unit_id,'salesCaseId',c.sales_case_id));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(p_tenant,'contract',p_contract,'contract.final_notice_delivered.v1',jsonb_build_object('contractVersionId',p_version,'obligationId',obligation));
  RETURN obligation;
END $$;

REVOKE ALL ON FUNCTION app.prepare_signature_payment_terms(uuid,uuid,uuid),
  app.materialize_signature_payment(uuid,uuid,uuid,text,date,uuid),
  app.record_sbk_final_notice(uuid,uuid,uuid,date,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prepare_signature_payment_terms(uuid,uuid,uuid),
  app.materialize_signature_payment(uuid,uuid,uuid,text,date,uuid),
  app.record_sbk_final_notice(uuid,uuid,uuid,date,uuid,uuid,text),
  app.create_contract_with_signature_payments(uuid,uuid,text,text,text,uuid,text,text,numeric) TO develocrm_app;

CREATE OR REPLACE FUNCTION app.sign_contract_externally(
  p_tenant uuid,p_contract uuid,p_version uuid,p_signed_at timestamptz,
  p_actor_membership uuid,p_note text DEFAULT NULL
) RETURNS TABLE(completed boolean,already_signed boolean,version_id uuid) LANGUAGE plpgsql AS $$
DECLARE contract_row contracts%ROWTYPE;actor uuid;current_version contract_versions%ROWTYPE;signature_time timestamptz:=COALESCE(p_signed_at,now());note_text text:=COALESCE(NULLIF(btrim(p_note),''),'Podpis smlouvy zaznamenán');
BEGIN
  PERFORM app.lock_workflow_unit(p_tenant,(SELECT unit_id FROM contracts WHERE tenant_id=p_tenant AND id=p_contract));
  SELECT * INTO contract_row FROM contracts WHERE tenant_id=p_tenant AND id=p_contract FOR UPDATE;
  SELECT user_id INTO actor FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor_membership AND status='active';
  IF contract_row.id IS NULL THEN RAISE EXCEPTION 'contract not found';END IF;
  IF actor IS NULL OR NOT app.has_project_permission(p_tenant,p_actor_membership,contract_row.project_id,'contract.sign') THEN RAISE EXCEPTION 'contract.sign permission required';END IF;
  SELECT * INTO current_version FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract ORDER BY version_number DESC,id DESC LIMIT 1 FOR UPDATE;
  IF current_version.id IS NULL THEN RAISE EXCEPTION 'contract requires a logical version';END IF;
  IF p_version IS NULL OR p_version<>current_version.id THEN RAISE EXCEPTION 'current contract version is required';END IF;
  IF contract_row.current_status='signed' THEN
    IF current_version.version_status<>'signed' THEN RAISE EXCEPTION 'signed contract version is inconsistent';END IF;
    PERFORM app.synchronize_signed_contract(p_tenant,p_contract,p_actor_membership,note_text);
    RETURN QUERY SELECT true,true,current_version.id;RETURN;
  END IF;
  IF contract_row.current_status NOT IN ('approved','signing') THEN RAISE EXCEPTION 'contract must be approved';END IF;
  IF current_version.version_status<>'approved_for_signing' THEN RAISE EXCEPTION 'approved contract version is required';END IF;
  IF signature_time>now()+interval '5 minutes' THEN RAISE EXCEPTION 'signature date cannot be in the future';END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_parties WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required) THEN RAISE EXCEPTION 'contract requires a signing party';END IF;
  UPDATE contract_parties SET signature_status='signed',signed_at=signature_time,signed_version_id=current_version.id
  WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required AND signature_status<>'signed';
  IF current_version.payment_terms_snapshot IS NOT NULL THEN
    SELECT max(signed_at) INTO signature_time FROM contract_parties
      WHERE tenant_id=p_tenant AND contract_id=p_contract AND signing_required;
    IF signature_time IS NULL OR signature_time>now()+interval '5 minutes' THEN
      RAISE EXCEPTION 'PAYMENT_TERMS_SIGNATURE_ANCHOR_MISMATCH'; END IF;
  END IF;
  UPDATE contract_versions SET version_status='signed',signed_at=signature_time,locked_at=now() WHERE tenant_id=p_tenant AND id=current_version.id;
  PERFORM set_config('app.contract_status_command','on',true);
  UPDATE contracts SET current_status='signed',signed_at=signature_time WHERE tenant_id=p_tenant AND id=p_contract;
  INSERT INTO contract_status_events(tenant_id,project_id,contract_id,from_status,to_status,command,reason,recorded_by_membership_id,source)
  VALUES(p_tenant,contract_row.project_id,p_contract,contract_row.current_status,'signed','recordExternalSignature',note_text,p_actor_membership,'signature');
  PERFORM app.synchronize_signed_contract(p_tenant,p_contract,p_actor_membership,note_text);
  INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
  VALUES(p_tenant,actor,'contract.signed','contract',p_contract,jsonb_build_object('versionId',current_version.id,'type',contract_row.contract_type,'signedAt',signature_time,'method','external'),jsonb_build_object('projectId',contract_row.project_id,'unitId',contract_row.unit_id,'note',NULLIF(btrim(p_note),'')));
  INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,'contract',p_contract,'contract.signed.v1',jsonb_build_object('contractId',p_contract,'versionId',current_version.id,'type',contract_row.contract_type,'unitId',contract_row.unit_id,'signedAt',signature_time,'method','external'));
  RETURN QUERY SELECT true,false,current_version.id;
END $$;

-- Contract users can inspect only this contract's agreed final-installment
-- context without gaining general ledger access or changing financial RBAC.
CREATE FUNCTION app.sbk_final_notice_context(p_tenant uuid,p_contract uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
DECLARE c contracts%ROWTYPE;v contract_versions%ROWTYPE;event payment_events%ROWTYPE;item jsonb;notice jsonb;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN RAISE EXCEPTION 'tenant context required'; END IF;
  SELECT * INTO c FROM contracts WHERE tenant_id=p_tenant AND id=p_contract;
  IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=p_tenant AND id=p_actor
    AND user_id=app.current_user_id() AND status='active') OR NOT app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.read') THEN
    RAISE EXCEPTION 'contract.read permission required'; END IF;
  IF c.contract_type<>'sbk' THEN RETURN NULL; END IF;
  SELECT * INTO v FROM contract_versions WHERE tenant_id=p_tenant AND contract_id=p_contract AND version_status='signed' ORDER BY version_number DESC LIMIT 1;
  IF v.id IS NULL OR v.payment_terms_snapshot->>'profile' IS DISTINCT FROM 'dejvice-original-dob-full-v1' THEN RETURN NULL; END IF;
  SELECT value INTO item FROM jsonb_array_elements(v.payment_terms_snapshot->'rows') WHERE value->>'key'='sbk_final';
  IF item IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO event FROM payment_events WHERE tenant_id=p_tenant AND project_id=c.project_id
    AND event_type='contract.final_notice_delivered' AND payload->>'contractVersionId'=v.id::text;
  IF event.id IS NOT NULL THEN
    SELECT jsonb_build_object('deliveredOn',event.payload->>'deliveredOn','documentId',d.id,'documentName',d.name,
      'webUrl',CASE WHEN app.has_project_permission(p_tenant,p_actor,c.project_id,'documents.read') THEN d.web_url ELSE NULL END,
      'dueOn',(SELECT (p.due_at AT TIME ZONE 'Europe/Prague')::date FROM payment_obligations p
        WHERE p.tenant_id=p_tenant AND p.contract_id=p_contract AND p.schedule_key='sbk_final')) INTO notice
      FROM document_versions dv JOIN documents d ON d.tenant_id=dv.tenant_id AND d.id=dv.document_id
      WHERE dv.tenant_id=p_tenant AND dv.id=(event.payload->>'evidenceDocumentVersionId')::uuid;
  END IF;
  RETURN jsonb_build_object('versionId',v.id,'amount',item->>'amount','signedOn',(c.signed_at AT TIME ZONE 'Europe/Prague')::date,
    'canRecord',event.id IS NULL AND (item->>'amount')::numeric>0 AND c.current_status='signed'
      AND EXISTS(SELECT 1 FROM sales_cases WHERE tenant_id=p_tenant AND id=c.sales_case_id AND status='active' AND closed_at IS NULL)
      AND app.has_project_permission(p_tenant,p_actor,c.project_id,'contract.manage')
      AND app.has_project_permission(p_tenant,p_actor,c.project_id,'documents.upload'),
    'notice',notice);
END $$;
REVOKE ALL ON FUNCTION app.sbk_final_notice_context(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sbk_final_notice_context(uuid,uuid,uuid) TO develocrm_app;

COMMIT;
