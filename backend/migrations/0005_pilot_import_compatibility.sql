BEGIN;

-- Pilotní import musí uchovat zdrojová data beze ztráty a bez domýšlení.
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS usable_area_m2 numeric(10,2)
    CHECK (usable_area_m2 IS NULL OR usable_area_m2 > 0);

ALTER TABLE accessories
  ADD COLUMN IF NOT EXISTS floor_label text;

ALTER TABLE unit_price_history
  ADD COLUMN IF NOT EXISTS amount_net numeric(15,2)
    CHECK (amount_net IS NULL OR (amount_net >= 0 AND amount_net <= amount));

ALTER TABLE accessory_price_history
  ADD COLUMN IF NOT EXISTS amount_net numeric(16,2)
    CHECK (amount_net IS NULL OR (amount_net >= 0 AND amount_net <= amount));

-- U historických importů nemusí zdroj obsahovat přesný okamžik zájmu.
ALTER TABLE unit_interests
  ALTER COLUMN first_interest_at DROP NOT NULL,
  ALTER COLUMN last_interest_at DROP NOT NULL;
ALTER TABLE unit_interests DROP CONSTRAINT unit_interest_time;
ALTER TABLE unit_interests ADD CONSTRAINT unit_interest_time CHECK (
  (first_interest_at IS NULL AND last_interest_at IS NULL)
  OR (first_interest_at IS NOT NULL AND last_interest_at IS NOT NULL AND last_interest_at >= first_interest_at)
);

ALTER TABLE sales_cases ALTER COLUMN opened_at DROP NOT NULL;
ALTER TABLE sales_cases DROP CONSTRAINT sales_case_closed_shape;
ALTER TABLE sales_cases ADD CONSTRAINT sales_case_closed_shape CHECK (
  status <> 'active' OR closed_at IS NULL
);

ALTER TABLE sales_case_parties ALTER COLUMN joined_at DROP NOT NULL;
ALTER TABLE sales_case_parties DROP CONSTRAINT sales_case_party_range;
ALTER TABLE sales_case_parties ADD CONSTRAINT sales_case_party_range CHECK (
  joined_at IS NULL OR left_at IS NULL OR left_at > joined_at
);

ALTER TABLE sales_stage_events ALTER COLUMN occurred_at DROP NOT NULL;
ALTER TABLE interest_events ALTER COLUMN occurred_at DROP NOT NULL;
ALTER TABLE contract_status_events ALTER COLUMN occurred_at DROP NOT NULL;

CREATE OR REPLACE VIEW unit_price_intervals AS
SELECT price.*,lead(valid_from) OVER (PARTITION BY tenant_id,unit_id,price_type ORDER BY valid_from,recorded_at,id) valid_to
FROM unit_price_history price;

-- Aktivní hold nadále vždy vyžaduje úplný časový interval. Pouze ukončený
-- historický záznam může nést NULL, pokud zdroj přesné datum neobsahuje.
ALTER TABLE unit_holds
  ALTER COLUMN starts_at DROP NOT NULL,
  ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE unit_holds DROP CONSTRAINT unit_hold_time;
ALTER TABLE unit_holds DROP CONSTRAINT unit_hold_end_state;
ALTER TABLE unit_holds ADD CONSTRAINT unit_hold_time CHECK (
  (status = 'active' AND starts_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > starts_at)
  OR (status <> 'active' AND (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at))
);
ALTER TABLE unit_holds ADD CONSTRAINT unit_hold_end_state CHECK (
  status <> 'active' OR ended_at IS NULL
);

COMMIT;
