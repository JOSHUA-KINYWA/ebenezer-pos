-- Repair weighted/volume sales so kg, gram, litre, and other decimal quantities
-- are stored and deducted as decimals instead of whole numbers.
--
-- Run once in the Supabase SQL Editor for existing databases.

CREATE TABLE IF NOT EXISTS drawer_balance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drawer_balance_id uuid REFERENCES drawer_balances(id) ON DELETE SET NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  action text NOT NULL DEFAULT 'manual_count',
  cash_before numeric(12,2) NOT NULL DEFAULT 0,
  coin_before numeric(12,2) NOT NULL DEFAULT 0,
  till_before numeric(12,2) NOT NULL DEFAULT 0,
  cash_after numeric(12,2) NOT NULL DEFAULT 0,
  coin_after numeric(12,2) NOT NULL DEFAULT 0,
  till_after numeric(12,2) NOT NULL DEFAULT 0,
  cash_delta numeric(12,2) NOT NULL DEFAULT 0,
  coin_delta numeric(12,2) NOT NULL DEFAULT 0,
  till_delta numeric(12,2) NOT NULL DEFAULT 0,
  note text,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drawer_balance_logs_date ON drawer_balance_logs(date);
CREATE INDEX IF NOT EXISTS idx_drawer_balance_logs_balance_id ON drawer_balance_logs(drawer_balance_id);

ALTER TABLE drawer_balance_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pos_public_drawer_balance_logs" ON drawer_balance_logs;
CREATE POLICY "pos_public_drawer_balance_logs" ON drawer_balance_logs FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS cashier_device_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_name text,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')) DEFAULT 'pending',
  requested_duration_hours integer NOT NULL DEFAULT 12,
  approved_duration_hours integer,
  expires_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_cashier_device_approvals_status ON cashier_device_approvals(status);
CREATE INDEX IF NOT EXISTS idx_cashier_device_approvals_user_id ON cashier_device_approvals(user_id);

ALTER TABLE cashier_device_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pos_public_cashier_device_approvals" ON cashier_device_approvals;
CREATE POLICY "pos_public_cashier_device_approvals" ON cashier_device_approvals FOR ALL USING (true) WITH CHECK (true);

DROP VIEW IF EXISTS product_sales_summary CASCADE;
DROP VIEW IF EXISTS daily_sales_summary CASCADE;

ALTER TABLE products
  ALTER COLUMN stock_qty TYPE numeric(12,2) USING stock_qty::numeric(12,2),
  ALTER COLUMN stock_alert TYPE numeric(12,2) USING stock_alert::numeric(12,2);

ALTER TABLE sale_items
  ALTER COLUMN quantity TYPE numeric(12,2) USING quantity::numeric(12,2),
  ALTER COLUMN unit_price TYPE numeric(12,2) USING unit_price::numeric(12,2),
  ALTER COLUMN subtotal TYPE numeric(12,2) USING subtotal::numeric(12,2);

ALTER TABLE stock_log
  ALTER COLUMN change_qty TYPE numeric(12,2) USING change_qty::numeric(12,2);

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
  coalesce(sum(si.subtotal), 0) AS total_revenue,
  coalesce(sum(si.quantity * p.cost_price), 0) AS total_cost
FROM sale_items si
JOIN sales s ON s.id = si.sale_id AND s.is_voided = false
LEFT JOIN products p ON p.id = si.product_id
GROUP BY si.product_name, p.unit
ORDER BY total_revenue DESC;

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
      (v_item->>'quantity')::numeric,
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
