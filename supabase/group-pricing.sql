-- Group / bundle pricing support
-- Adds the ability to sell products in fixed-size packs (e.g., 3 items for KSh 10)
-- Run in the Supabase SQL Editor for existing databases.

ALTER TABLE products ADD COLUMN IF NOT EXISTS group_size integer NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS group_price numeric(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS pricing_tiers jsonb DEFAULT '[]'::jsonb;

-- group_size: number of individual units sold together as one pack (default 1 = sold individually)
-- group_price: if set, the price for the entire pack. The per-unit price is
--              calculated as group_price / group_size. When NULL the regular
--              `price` column is used as the per-unit price.
-- pricing_tiers: JSONB array of { "min_qty": number, "price": number } objects for
--                tiered pack pricing (e.g., [{ "min_qty": 1, "price": 5 }, { "min_qty": 2, "price": 10 }]).
--                When set, the sell page shows quick-select tier buttons.
