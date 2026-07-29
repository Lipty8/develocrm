DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='develocrm_runtime') THEN
    CREATE ROLE develocrm_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE develocrm_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
GRANT develocrm_app TO develocrm_runtime;

-- Heslo se zde záměrně nenastavuje. Nastavte je jednorázově bezpečným kanálem,
-- nebo použijte Entra PostgreSQL autentizaci. Ověření:
-- SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls FROM pg_roles WHERE rolname='develocrm_runtime';
-- SELECT pg_has_role('develocrm_runtime','develocrm_app','member');
