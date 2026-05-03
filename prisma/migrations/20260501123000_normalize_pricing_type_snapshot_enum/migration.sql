DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'PricingTypeSnapshot'
  ) THEN
    CREATE TYPE "PricingTypeSnapshot" AS ENUM ('FIXED', 'TIME');
  END IF;
END $$;

UPDATE "order_items"
SET "pricingTypeSnapshot" = 'FIXED'
WHERE "pricingTypeSnapshot" IS NULL
   OR "pricingTypeSnapshot" NOT IN ('FIXED', 'TIME');

ALTER TABLE "order_items"
  ALTER COLUMN "pricingTypeSnapshot" DROP DEFAULT;

ALTER TABLE "order_items"
  ALTER COLUMN "pricingTypeSnapshot" TYPE "PricingTypeSnapshot"
  USING "pricingTypeSnapshot"::"PricingTypeSnapshot";

ALTER TABLE "order_items"
  ALTER COLUMN "pricingTypeSnapshot" SET DEFAULT 'FIXED';

ALTER TABLE "order_items"
  ALTER COLUMN "pricingTypeSnapshot" SET NOT NULL;
