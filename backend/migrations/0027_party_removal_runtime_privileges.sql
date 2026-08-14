BEGIN;

-- Smazání čistého klienta zůstává jedinou řízenou doménovou operací. Funkce
-- sama ověřuje tenant, aktéra a clients.archive ve všech aktivních projektech;
-- SECURITY DEFINER jí pouze dovolí odstranit chráněné podřízené řádky bez
-- udělení obecného DELETE oprávnění runtime roli.
ALTER FUNCTION app.remove_or_archive_party(uuid,uuid,uuid,text) SECURITY DEFINER;
ALTER FUNCTION app.remove_or_archive_party(uuid,uuid,uuid,text) SET search_path=public,app;
REVOKE ALL ON FUNCTION app.remove_or_archive_party(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_or_archive_party(uuid,uuid,uuid,text) TO develocrm_app;

COMMIT;
