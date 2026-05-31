ALTER TABLE orders
ADD COLUMN IF NOT EXISTS "leftAt" timestamptz(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'leftTime'
  ) THEN
    EXECUTE 'UPDATE orders SET "leftAt" = COALESCE("leftAt", "leftTime") WHERE "leftTime" IS NOT NULL';
  END IF;
END $$;
