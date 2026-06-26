-- Run this in Supabase: SQL Editor → New query → paste → Run
-- Creates the default owner account and sample products for first login.

-- Owner account (README default credentials)
INSERT INTO users (full_name, email, pin, role, is_active)
SELECT 'Shop Owner', 'owner@ebenezarshop.com', '1234', 'owner', true
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE email = 'owner@ebenezarshop.com'
);

-- Sample categories
INSERT INTO categories (name)
SELECT 'Beverages'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Beverages');

INSERT INTO categories (name)
SELECT 'Snacks'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Snacks');

INSERT INTO categories (name)
SELECT 'Household'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Household');

-- Sample products
INSERT INTO products (name, price, unit, stock_qty, stock_alert, category_id, is_active)
SELECT 'Mineral Water 500ml', 50, 'piece', 100, 20, c.id, true
FROM categories c
WHERE c.name = 'Beverages'
  AND NOT EXISTS (SELECT 1 FROM products WHERE name = 'Mineral Water 500ml');

INSERT INTO products (name, price, unit, stock_qty, stock_alert, category_id, is_active)
SELECT 'Bread Loaf', 60, 'piece', 30, 10, c.id, true
FROM categories c
WHERE c.name = 'Snacks'
  AND NOT EXISTS (SELECT 1 FROM products WHERE name = 'Bread Loaf');

INSERT INTO products (name, price, unit, stock_qty, stock_alert, category_id, is_active)
SELECT 'Washing Soap', 120, 'piece', 50, 15, c.id, true
FROM categories c
WHERE c.name = 'Household'
  AND NOT EXISTS (SELECT 1 FROM products WHERE name = 'Washing Soap');
