BEGIN;
-- Extend the existing project-owned seller settings. Do not infer or backfill
-- names, accounts or addresses from legal documents or demo/import snapshots.
ALTER TABLE project_contract_settings
  ADD COLUMN seller_signature_name text,
  ADD COLUMN seller_client_changes_bank_account text,
  ADD COLUMN seller_delivery_address text;
ALTER TABLE project_contract_settings
  ADD CONSTRAINT project_contract_seller_signature_length CHECK (length(seller_signature_name)<=500),
  ADD CONSTRAINT project_contract_client_changes_account_length CHECK (length(seller_client_changes_bank_account)<=500),
  ADD CONSTRAINT project_contract_delivery_address_length CHECK (length(seller_delivery_address)<=500);
-- Existing FORCE RLS, project permission checks, audit and outbox paths remain.
-- NULL means not supplied; readiness for the specific template decides whether
-- a field is required. Existing contracts and generation snapshots do not change.
COMMIT;
