DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'isDebt'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'isDebtMarked'
  ) THEN
    ALTER TABLE "orders" RENAME COLUMN "isDebt" TO "isDebtMarked";
  END IF;
END
$$;

ALTER TABLE "orders"
ADD COLUMN IF NOT EXISTS "isDebtMarked" BOOLEAN NOT NULL DEFAULT false;
