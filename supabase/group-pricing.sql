-- Group / bundle pricing support via pricing_tiers
-- Allows multiple quantity-based pricing (e.g., 1 @ KSh 5, 2 @ KSh 10)
-- Run in the Supabase SQL Editor for existing databases.

ALTER TABLE products ADD COLUMN IF NOT EXISTS pricing_tiers jsonb DEFAULT '[]'::jsonb;

-- pricing_tiers: JSONB array of { "min_qty": number, "price": number } objects for
--                tiered pack pricing (e.g., [{ "min_qty": 1, "price": 5 }, { "min_qty": 2, "price": 10 }]).
--                When set, the sell page shows quick-select tier buttons.
