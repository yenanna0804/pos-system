-- Use PostgreSQL sequence for order code generation to avoid MAX+1 race conditions.

CREATE SEQUENCE IF NOT EXISTS "orders_order_code_seq";

DO $$
DECLARE
  max_seq bigint;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING("orderCode" FROM 9) AS bigint)), 0)
  INTO max_seq
  FROM "orders"
  WHERE "orderCode" ~ '^HD[0-9]{6}[0-9]+$';

  IF max_seq > 0 THEN
    PERFORM setval('public.orders_order_code_seq', max_seq, true);
  ELSE
    PERFORM setval('public.orders_order_code_seq', 1, false);
  END IF;
END $$;
