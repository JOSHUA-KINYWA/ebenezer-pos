-- Run in Supabase SQL Editor if login still fails after seeding.
-- This POS app uses custom PIN auth (not Supabase Auth), so the
-- anon/publishable key needs access to read and write these tables.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_public_users" ON users;
DROP POLICY IF EXISTS "pos_public_categories" ON categories;
DROP POLICY IF EXISTS "pos_public_products" ON products;
DROP POLICY IF EXISTS "pos_public_sales" ON sales;
DROP POLICY IF EXISTS "pos_public_sale_items" ON sale_items;
DROP POLICY IF EXISTS "pos_public_stock_log" ON stock_log;
DROP POLICY IF EXISTS "pos_public_expenses" ON expenses;
DROP POLICY IF EXISTS "pos_public_shop_settings" ON shop_settings;

CREATE POLICY "pos_public_users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_sales" ON sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_sale_items" ON sale_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_stock_log" ON stock_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_expenses" ON expenses FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pos_public_shop_settings" ON shop_settings FOR ALL USING (true) WITH CHECK (true);
