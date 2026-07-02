-- Run after schema.sql or on existing databases to add new features

-- Shop settings table
CREATE TABLE IF NOT EXISTS shop_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name text NOT NULL DEFAULT 'Ebenezar Shop',
  shop_address text DEFAULT 'Nairobi, Kenya',
  shop_phone text DEFAULT '',
  currency text NOT NULL DEFAULT 'KSh',
  receipt_footer text DEFAULT 'Thank you for shopping with us!',
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO shop_settings (shop_name, shop_address, currency, receipt_footer)
SELECT 'Ebenezar Shop', 'Nairobi, Kenya', 'KSh', 'Thank you for shopping with us!'
WHERE NOT EXISTS (SELECT 1 FROM shop_settings);

-- Customers table for sale customer support
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

-- Shifts table for open/closed shift tracking
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

-- Extra sale columns
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS subtotal numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS tax_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS total_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'cash';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_payment_method_check'
      AND conrelid = 'sales'::regclass
  ) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check CHECK (payment_method IN ('cash', 'coin', 'till'));
  END IF;
END
$$;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS mpesa_ref text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS card_ref text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_tendered numeric(12,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_amount numeric(12,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_voided boolean NOT NULL DEFAULT false;

-- Expenses support
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  vendor text,
  category text,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'till')),
  payment_note text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE expenses DROP COLUMN IF EXISTS payment_type;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method text NOT NULL CHECK (payment_method IN ('cash', 'till'));
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pos_public_expenses" ON expenses;
CREATE POLICY "pos_public_expenses" ON expenses FOR ALL USING (true) WITH CHECK (true);

-- Product variant support
ALTER TABLE products ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_product_id uuid REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS initial_stock numeric(12,2) DEFAULT 0;
UPDATE products SET initial_stock = stock_qty WHERE initial_stock = 0 OR initial_stock IS NULL;

-- Staff account support
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin text;

-- Support decimal quantities for items sold by weight/volume
ALTER TABLE products ALTER COLUMN stock_qty TYPE numeric(12,2) USING stock_qty::numeric(12,2);
ALTER TABLE stock_log ALTER COLUMN change_qty TYPE numeric(12,2) USING change_qty::numeric(12,2);
ALTER TABLE sale_items ALTER COLUMN quantity TYPE numeric(12,2) USING quantity::numeric(12,2);

-- Refresh report views
DROP VIEW IF EXISTS daily_sales_summary;
DROP VIEW IF EXISTS product_sales_summary;

CREATE VIEW daily_sales_summary AS
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

CREATE VIEW product_sales_summary AS
SELECT
  si.product_name AS name,
  coalesce(p.unit, 'piece') AS unit,
  sum(si.quantity)::integer AS units_sold,
  coalesce(sum(si.subtotal), 0) AS total_revenue
FROM sale_items si
JOIN sales s ON s.id = si.sale_id AND s.is_voided = false
LEFT JOIN products p ON p.id = si.product_id
GROUP BY si.product_name, p.unit
ORDER BY total_revenue DESC;

-- RLS for shop_settings
ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pos_public_shop_settings" ON shop_settings;
CREATE POLICY "pos_public_shop_settings" ON shop_settings FOR ALL USING (true) WITH CHECK (true);

-- Drawer balances: track cash/coin/till per date and shift
CREATE TABLE IF NOT EXISTS drawer_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  cash numeric(12,2) NOT NULL DEFAULT 0,
  coin numeric(12,2) NOT NULL DEFAULT 0,
  till numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(date, shift_id)
);

-- Function to adjust drawer balances (decrement when expenses occur)
CREATE OR REPLACE FUNCTION adjust_drawer_balance(p_method text, p_amount numeric, p_date date, p_shift_id uuid)
RETURNS void AS $$
BEGIN
  IF p_method = 'cash' THEN
    UPDATE drawer_balances
    SET cash = cash - p_amount, updated_at = now()
    WHERE date = p_date AND shift_id IS NOT DISTINCT FROM p_shift_id;
    IF NOT FOUND THEN
      INSERT INTO drawer_balances(date, shift_id, cash, coin, till)
      VALUES (p_date, p_shift_id, -p_amount, 0, 0);
    END IF;
  ELSIF p_method = 'coin' THEN
    UPDATE drawer_balances
    SET coin = coin - p_amount, updated_at = now()
    WHERE date = p_date AND shift_id IS NOT DISTINCT FROM p_shift_id;
    IF NOT FOUND THEN
      INSERT INTO drawer_balances(date, shift_id, cash, coin, till)
      VALUES (p_date, p_shift_id, 0, -p_amount, 0);
    END IF;
  ELSIF p_method = 'till' THEN
    UPDATE drawer_balances
    SET till = till - p_amount, updated_at = now()
    WHERE date = p_date AND shift_id IS NOT DISTINCT FROM p_shift_id;
    IF NOT FOUND THEN
      INSERT INTO drawer_balances(date, shift_id, cash, coin, till)
      VALUES (p_date, p_shift_id, 0, 0, -p_amount);
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE drawer_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pos_public_drawer_balances" ON drawer_balances;
CREATE POLICY "pos_public_drawer_balances" ON drawer_balances FOR ALL USING (true) WITH CHECK (true);

-- Atomic sale recording: sale + items + drawer balance
-- Stock deduction and stock_log are handled by trg_sale_items_deduct_stock trigger
CREATE OR REPLACE FUNCTION record_sale(
  p_user_id uuid,
  p_shift_id uuid,
  p_customer_id uuid,
  p_subtotal numeric,
  p_tax_amount numeric,
  p_total_amount numeric,
  p_payment_type text,
  p_payment_method text,
  p_discount numeric,
  p_mpesa_ref text,
  p_card_ref text,
  p_amount_tendered numeric,
  p_change_amount numeric,
  p_note text,
  p_receipt_no text,
  p_date date,
  p_items jsonb
)
RETURNS uuid AS $$
DECLARE
  v_sale_id uuid;
  v_item jsonb;
BEGIN
  INSERT INTO sales(
    user_id, shift_id, customer_id, subtotal, tax_amount, total_amount,
    payment_type, payment_method, discount, mpesa_ref, card_ref,
    amount_tendered, change_amount, note, receipt_no
  ) VALUES (
    p_user_id, p_shift_id, p_customer_id, p_subtotal, p_tax_amount, p_total_amount,
    p_payment_type, p_payment_method, p_discount, p_mpesa_ref, p_card_ref,
    p_amount_tendered, p_change_amount, p_note, p_receipt_no
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO sale_items(
      sale_id, product_id, product_name, quantity, unit_price, subtotal
    ) VALUES (
      v_sale_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      (v_item->>'subtotal')::numeric
    );
  END LOOP;

  IF p_payment_method = 'cash' THEN
    UPDATE drawer_balances
    SET cash = cash + p_total_amount, updated_at = now()
    WHERE date = p_date AND shift_id IS NOT DISTINCT FROM p_shift_id;
    IF NOT FOUND THEN
      INSERT INTO drawer_balances(date, shift_id, cash, coin, till)
      VALUES (p_date, p_shift_id, p_total_amount, 0, 0);
    END IF;
  ELSIF p_payment_method = 'coin' THEN
    UPDATE drawer_balances
    SET coin = coin + p_total_amount, updated_at = now()
    WHERE date = p_date AND shift_id IS NOT DISTINCT FROM p_shift_id;
    IF NOT FOUND THEN
      INSERT INTO drawer_balances(date, shift_id, cash, coin, till)
      VALUES (p_date, p_shift_id, 0, p_total_amount, 0);
    END IF;
  ELSIF p_payment_method = 'till' THEN
    UPDATE drawer_balances
    SET till = till + p_total_amount, updated_at = now()
    WHERE date = p_date AND shift_id IS NOT DISTINCT FROM p_shift_id;
    IF NOT FOUND THEN
      INSERT INTO drawer_balances(date, shift_id, cash, coin, till)
      VALUES (p_date, p_shift_id, 0, 0, p_total_amount);
    END IF;
  END IF;

  RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql;

-- Get current drawer balance for a date (sums all shifts when shift_id is null)
CREATE OR REPLACE FUNCTION get_drawer_balance(p_date date, p_shift_id uuid DEFAULT NULL)
RETURNS TABLE(cash numeric, coin numeric, till numeric) AS $$
BEGIN
  IF p_shift_id IS NULL THEN
    RETURN QUERY
    SELECT COALESCE(SUM(db.cash), 0)::numeric, COALESCE(SUM(db.coin), 0)::numeric, COALESCE(SUM(db.till), 0)::numeric
    FROM drawer_balances db
    WHERE db.date = p_date;
  ELSE
    RETURN QUERY
    SELECT db.cash, db.coin, db.till
    FROM drawer_balances db
    WHERE db.date = p_date AND db.shift_id = p_shift_id
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Set drawer balance manually (for cashier count/reconciliation)
CREATE OR REPLACE FUNCTION set_drawer_balance(
  p_date date,
  p_shift_id uuid,
  p_cash numeric DEFAULT 0,
  p_coin numeric DEFAULT 0,
  p_till numeric DEFAULT 0
)
RETURNS void AS $$
BEGIN
  INSERT INTO drawer_balances(date, shift_id, cash, coin, till, updated_at)
  VALUES (p_date, p_shift_id, p_cash, p_coin, p_till, now())
  ON CONFLICT (date, shift_id) DO UPDATE
  SET cash = EXCLUDED.cash, coin = EXCLUDED.coin, till = EXCLUDED.till, updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Record a manual drawer adjustment with audit note
CREATE OR REPLACE FUNCTION record_drawer_adjustment(
  p_date date,
  p_shift_id uuid,
  p_method text,
  p_amount numeric,
  p_note text DEFAULT ''
)
RETURNS void AS $$
BEGIN
  IF p_method = 'cash' THEN
    UPDATE drawer_balances
    SET cash = cash + p_amount, updated_at = now()
    WHERE date = p_date AND shift_id IS NOT DISTINCT FROM p_shift_id;
    IF NOT FOUND THEN
      INSERT INTO drawer_balances(date, shift_id, cash, coin, till)
      VALUES (p_date, p_shift_id, p_amount, 0, 0);
    END IF;
  ELSIF p_method = 'coin' THEN
    UPDATE drawer_balances
    SET coin = coin + p_amount, updated_at = now()
    WHERE date = p_date AND shift_id IS NOT DISTINCT FROM p_shift_id;
    IF NOT FOUND THEN
      INSERT INTO drawer_balances(date, shift_id, cash, coin, till)
      VALUES (p_date, p_shift_id, 0, p_amount, 0);
    END IF;
  ELSIF p_method = 'till' THEN
    UPDATE drawer_balances
    SET till = till + p_amount, updated_at = now()
    WHERE date = p_date AND shift_id IS NOT DISTINCT FROM p_shift_id;
    IF NOT FOUND THEN
      INSERT INTO drawer_balances(date, shift_id, cash, coin, till)
      VALUES (p_date, p_shift_id, 0, 0, p_amount);
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;
