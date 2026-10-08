BEGIN;

CREATE OR REPLACE FUNCTION app.seed_default_document_types(p_tenant uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
  INSERT INTO public.document_types(tenant_id,code,name,sort_order)
  VALUES
    (p_tenant,'reservation_contract','Rezervační smlouva',10),
    (p_tenant,'future_purchase_contract','Smlouva o budoucí kupní smlouvě',20),
    (p_tenant,'purchase_contract','Kupní smlouva',30),
    (p_tenant,'amendment','Dodatek',40),
    (p_tenant,'handover_protocol','Předávací protokol',50),
    (p_tenant,'photo_documentation','Fotodokumentace',60),
    (p_tenant,'client_change','Klientská změna',70),
    (p_tenant,'complaint_protocol','Reklamační protokol',80),
    (p_tenant,'other','Ostatní dokument',100)
  ON CONFLICT(tenant_id,code) DO NOTHING
$$;

SELECT app.seed_default_document_types(id) FROM public.tenants;

CREATE OR REPLACE FUNCTION app.seed_document_types_for_new_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
BEGIN
  PERFORM app.seed_default_document_types(NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER tenants_seed_default_document_types
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app.seed_document_types_for_new_tenant();

COMMIT;
