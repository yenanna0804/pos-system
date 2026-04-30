-- Persist adjustment mode and raw values for invoice-level discount/surcharge.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderAdjustmentMode') THEN
    CREATE TYPE "OrderAdjustmentMode" AS ENUM ('amount', 'percent');
  END IF;
END $$;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "discountMode" "OrderAdjustmentMode" NOT NULL DEFAULT 'amount';

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "discountValue" DECIMAL(12,4) NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "surchargeMode" "OrderAdjustmentMode" NOT NULL DEFAULT 'amount';

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "surchargeValue" DECIMAL(12,4) NOT NULL DEFAULT 0;

UPDATE "orders"
SET
  "discountMode" = COALESCE("discountMode", 'amount'::"OrderAdjustmentMode"),
  "surchargeMode" = COALESCE("surchargeMode", 'amount'::"OrderAdjustmentMode"),
  "discountValue" = COALESCE("discountValue", COALESCE("discountAmount", 0)),
  "surchargeValue" = COALESCE("surchargeValue", COALESCE("surchargeAmount", 0));
