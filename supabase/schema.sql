-- Ebenezar POS — Enhanced Database Schema
-- Run in Supabase SQL Editor for new projects

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- MIGRATION: Convert integer columns to numeric(12,2) for
-- decimal stock/quantity support (e.g., selling 0.19 kg)
-- Safe to run on existing databases - drops/recreates views
-- ============================================================

-- Step 1: Drop views that block column type changes
DROP VIEW IF EXISTS product_sales_summary CASCADE;
DROP VIEW IF EXISTS daily_sales_summary CASCADE;
DROP VIEW IF EXISTS low_stock_products CASCADE;
DROP VIEW IF EXISTS active_products CASCADE;
DROP VIEW IF EXISTS inventory_value CASCADE;
DROP VIEW IF EXISTS sales_by_payment CASCADE;

-- Step 2: Alter columns to numeric(12,2) (handles decimal stock/quantity)
ALTER TABLE stock_log ALTER COLUMN change_qty TYPE numeric(12,2) USING change_qty::numeric(12,2);
ALTER TABLE products ALTER COLUMN stock_qty TYPE numeric(12,2) USING stock_qty::numeric(12,2);
ALTER TABLE products ALTER COLUMN stock_alert TYPE numeric(12,2) USING stock_alert::numeric(12,2);
ALTER TABLE sale_items ALTER COLUMN quantity TYPE numeric(12,2) USING quantity::numeric(12,2);
ALTER TABLE sale_items ALTER COLUMN subtotal TYPE numeric(12,2) USING subtotal::numeric(12,2);
ALTER TABLE sale_items ALTER COLUMN unit_price TYPE numeric(12,2) USING unit_price::numeric(12,2);
ALTER TABLE sales ALTER COLUMN total_amount TYPE numeric(12,2) USING total_amount::numeric(12,2);
ALTER TABLE sales ALTER COLUMN subtotal TYPE numeric(12,2) USING subtotal::numeric(12,2);
ALTER TABLE sales ALTER COLUMN tax_amount TYPE numeric(12,2) USING tax_amount::numeric(12,2);
ALTER TABLE sales ALTER COLUMN discount TYPE numeric(12,2) USING discount::numeric(12,2);
ALTER TABLE sales ALTER COLUMN amount_tendered TYPE numeric(12,2) USING amount_tendered::numeric(12,2);
ALTER TABLE sales ALTER COLUMN change_amount TYPE numeric(12,2) USING change_amount::numeric(12,2);
ALTER TABLE shifts ALTER COLUMN opening_balance TYPE numeric(12,2) USING opening_balance::numeric(12,2);
ALTER TABLE shifts ALTER COLUMN expected_balance TYPE numeric(12,2) USING expected_balance::numeric(12,2);
ALTER TABLE shifts ALTER COLUMN actual_balance TYPE numeric(12,2) USING actual_balance::numeric(12,2);
ALTER TABLE shifts ALTER COLUMN variance TYPE numeric(12,2) USING variance::numeric(12,2);
ALTER TABLE drawer_balances ALTER COLUMN cash TYPE numeric(12,2) USING cash::numeric(12,2);
ALTER TABLE drawer_balances ALTER COLUMN coin TYPE numeric(12,2) USING coin::numeric(12,2);
ALTER TABLE drawer_balances ALTER COLUMN till TYPE numeric(12,2) USING till::numeric(12,2);

-- Step 3: Recreate triggers and functions
CREATE OR REPLACE FUNCTION generate_receipt_no()
RETURNS trigger AS $$
BEGIN
  IF NEW.receipt_no IS NULL THEN
    NEW.receipt_no := 'RCP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('receipt_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_receipt_no ON sales;
CREATE TRIGGER trg_sales_receipt_no
  BEFORE INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION generate_receipt_no();

CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE products
    SET stock_qty = GREATEST(0, stock_qty - NEW.quantity)
    WHERE id = NEW.product_id;

    INSERT INTO stock_log (product_id, change_qty, reason, note)
    VALUES (NEW.product_id, -NEW.quantity, 'sale', 'Auto deduct from sale');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sale_items_deduct_stock ON sale_items;
CREATE TRIGGER trg_sale_items_deduct_stock
  AFTER INSERT ON sale_items
  FOR EACH ROW EXECUTE FUNCTION deduct_stock_on_sale();

-- Step 4: Recreate report views with numeric-safe types
CREATE OR REPLACE VIEW daily_sales_summary AS
SELECT
  date(created_at) AS sale_date,
  count(*)::integer AS total_transactions,
  coalesce(sum(total_amount), 0) AS total_revenue,
  coalesce(sum(CASE WHEN payment_type = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_total,
  coalesce(sum(CASE WHEN payment_type = 'mpesa' THEN total_amount ELSE 0 END), 0) AS mpesa_total,
  coalesce(sum(CASE WHEN payment_type IN ('card','credit') THEN total_amount ELSE 0 END), 0) AS card_total
FROM sales
WHERE is_voided = false
GROUP BY date(created_at)
ORDER BY sale_date DESC;

CREATE OR REPLACE VIEW product_sales_summary AS
SELECT
  si.product_name AS name,
  coalesce(p.unit, 'piece') AS unit,
  sum(si.quantity)::numeric(12,2) AS units_sold,
  coalesce(sum(si.subtotal), 0) AS total_revenue
FROM sale_items si
JOIN sales s ON s.id = si.sale_id AND s.is_voided = false
LEFT JOIN products p ON p.id = si.product_id
GROUP BY si.product_name, p.unit
ORDER BY total_revenue DESC;

-- ============================================================
-- END OF MIGRATION
-- ============================================================


CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('owner', 'cashier')),
  pin text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Pending account requests (for owner approval workflow)
CREATE TABLE IF NOT EXISTS pending_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  requested_role text NOT NULL DEFAULT 'cashier',
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pending_accounts_status ON pending_accounts(status);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Products with enhanced fields
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  barcode text UNIQUE,
  variety text,
  description text,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  parent_product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  price numeric(12,2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'piece',
  initial_stock numeric(12,2) NOT NULL DEFAULT 0,
  stock_qty numeric(12,2) NOT NULL DEFAULT 0,
  stock_alert numeric(12,2) NOT NULL DEFAULT 10,
  reorder_qty numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  pricing_tiers jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Customers (NEW)
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  address text,
  credit_limit numeric(12,2) DEFAULT 0,
  credit_balance numeric(12,2) DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Shop settings (single row)
CREATE TABLE IF NOT EXISTS shop_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name text NOT NULL DEFAULT 'Ebenezar Shop',
  shop_address text DEFAULT 'Nairobi, Kenya',
  shop_phone text DEFAULT '',
  currency text NOT NULL DEFAULT 'KSh',
  receipt_footer text DEFAULT 'Thank you for shopping with us!',
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  logo_url text,
  email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Receipt number sequence
CREATE SEQUENCE IF NOT EXISTS receipt_seq START 1;

-- Shifts (NEW - for cash reconciliation)
CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_balance numeric(12,2) NOT NULL DEFAULT 0,
  expected_balance numeric(12,2),
  actual_balance numeric(12,2),
  variance numeric(12,2),
  status text NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sales (enhanced with customer & shift reference)
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  total_amount numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_type text NOT NULL CHECK (payment_type IN ('cash', 'mpesa', 'card', 'credit')),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'coin', 'till')),
  mpesa_ref text,
  card_ref text,
  discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  receipt_no text UNIQUE,
  amount_tendered numeric(12,2),
  change_amount numeric(12,2),
  note text,
  is_voided boolean NOT NULL DEFAULT false,
  voided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sale items
CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Expenses (NEW)
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  amount numeric(12,2) NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'coin', 'till')),
  payment_note text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cash_deducted numeric(12,2) NOT NULL DEFAULT 0,
  coin_deducted numeric(12,2) NOT NULL DEFAULT 0,
  till_deducted numeric(12,2) NOT NULL DEFAULT 0
);

-- Stock log (enhanced)
CREATE TABLE IF NOT EXISTS stock_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  change_qty numeric(12,2) NOT NULL,
  reason text NOT NULL CHECK (reason IN ('sale', 'restock', 'adjustment', 'damage', 'return')),
  note text,
  reference_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_log ALTER COLUMN change_qty TYPE numeric(12,2) USING change_qty::numeric(12,2);

-- Audit Log (NEW - for security)
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  table_name text,
  record_id text,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Payment Reconciliation (NEW)
CREATE TABLE IF NOT EXISTS payment_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  payment_type text NOT NULL CHECK (payment_type IN ('cash', 'mpesa', 'card', 'credit')),
  expected_amount numeric(12,2) NOT NULL DEFAULT 0,
  actual_amount numeric(12,2) NOT NULL DEFAULT 0,
  variance numeric(12,2) DEFAULT 0,
  status text NOT NULL CHECK (status IN ('pending', 'reconciled', 'discrepancy')) DEFAULT 'pending',
  reconciled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reconciled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(date, payment_type)
);

-- Auto-generate receipt number
CREATE OR REPLACE FUNCTION generate_receipt_no()
RETURNS trigger AS $$
BEGIN
  IF NEW.receipt_no IS NULL THEN
    NEW.receipt_no := 'RCP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('receipt_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_receipt_no ON sales;
CREATE TRIGGER trg_sales_receipt_no
  BEFORE INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION generate_receipt_no();

-- Deduct stock when sale items are added
CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE products
    SET stock_qty = GREATEST(0, stock_qty - NEW.quantity)
    WHERE id = NEW.product_id;

    INSERT INTO stock_log (product_id, change_qty, reason, note)
    VALUES (NEW.product_id, -NEW.quantity, 'sale', 'Auto deduct from sale');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sale_items_deduct_stock ON sale_items;
CREATE TRIGGER trg_sale_items_deduct_stock
  AFTER INSERT ON sale_items
  FOR EACH ROW EXECUTE FUNCTION deduct_stock_on_sale();

-- Report views (exclude voided sales)
CREATE OR REPLACE VIEW daily_sales_summary AS
SELECT
  date(created_at) AS sale_date,
  count(*)::integer AS total_transactions,
  coalesce(sum(total_amount), 0) AS total_revenue,
  coalesce(sum(CASE WHEN payment_type = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_total,
  coalesce(sum(CASE WHEN payment_type = 'mpesa' THEN total_amount ELSE 0 END), 0) AS mpesa_total,
  coalesce(sum(CASE WHEN payment_type IN ('card','credit') THEN total_amount ELSE 0 END), 0) AS card_total
FROM sales
WHERE is_voided = false
GROUP BY date(created_at)
ORDER BY sale_date DESC;

CREATE OR REPLACE VIEW product_sales_summary AS
SELECT
  si.product_name AS name,
  coalesce(p.unit, 'piece') AS unit,
  sum(si.quantity)::numeric(12,2) AS units_sold,
  coalesce(sum(si.subtotal), 0) AS total_revenue
FROM sale_items si
JOIN sales s ON s.id = si.sale_id AND s.is_voided = false
LEFT JOIN products p ON p.id = si.product_id
GROUP BY si.product_name, p.unit
ORDER BY total_revenue DESC;

-- RLS policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reconciliation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_public_users" ON users;
DROP POLICY IF EXISTS "pos_public_categories" ON categories;
DROP POLICY IF EXISTS "pos_public_products" ON products;
DROP POLICY IF EXISTS "pos_public_customers" ON customers;
DROP POLICY IF EXISTS "pos_public_sales" ON sales;
DROP POLICY IF EXISTS "pos_public_sale_items" ON sale_items;
DROP POLICY IF EXISTS "pos_public_stock_log" ON stock_log;
DROP POLICY IF EXISTS "pos_public_expenses" ON expenses;
DROP POLICY IF EXISTS "pos_public_shop_settings" ON shop_settings;
DROP POLICY IF EXISTS "pos_public_shifts" ON shifts;
DROP POLICY IF EXISTS "pos_public_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "pos_public_payment_reconciliation" ON payment_reconciliation;

CREATE POLICY "pos_public_users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_customers" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_sales" ON sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_sale_items" ON sale_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_stock_log" ON stock_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_expenses" ON expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_shop_settings" ON shop_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_shifts" ON shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_audit_logs" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "pos_public_payment_reconciliation" ON payment_reconciliation FOR ALL USING (true) WITH CHECK (true);

-- Default shop settings row
INSERT INTO shop_settings (shop_name, shop_address, currency, receipt_footer)
SELECT 'Ebenezar Shop', 'Nairobi, Kenya', 'KSh', 'Thank you for shopping with us!'
WHERE NOT EXISTS (SELECT 1 FROM shop_settings);

-- Drawer balances (cash reconciliation)
CREATE TABLE IF NOT EXISTS drawer_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  cash numeric(12,2) NOT NULL DEFAULT 0,
  coin numeric(12,2) NOT NULL DEFAULT 0,
  till numeric(12,2) NOT NULL DEFAULT 0,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drawer_balances_date ON drawer_balances(date);
CREATE INDEX IF NOT EXISTS idx_drawer_balances_shift_id ON drawer_balances(shift_id);
