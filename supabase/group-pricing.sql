-- Group / bundle pricing support
-- Adds the ability to sell products in fixed-size packs (e.g., 3 items for KSh 10)
-- Run in the Supabase SQL Editor for existing databases.

ALTER TABLE products ADD COLUMN IF NOT EXISTS group_size integer NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS group_price numeric(12,2);

-- group_size: number of individual units sold together as one pack (default 1 = sold individually)
-- group_price: if set, the price for the entire pack. The per-unit price is
--              calculated as group_price / group_size. When NULL the regular
--              `price` column is used as the per-unit price.
