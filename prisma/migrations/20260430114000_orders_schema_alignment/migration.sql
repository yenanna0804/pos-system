-- Align orders schema with service contract; remove runtime DDL dependency

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "roomId" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customerName" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'taxAmount'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'surchargeAmount'
  ) THEN
    EXECUTE 'ALTER TABLE "orders" RENAME COLUMN "taxAmount" TO "surchargeAmount"';
  END IF;
END $$;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "surchargeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "baseUnitPrice" DECIMAL(14,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_roomId_fkey'
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_roomId_fkey"
      FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE "orders"
SET "orderCode" = CONCAT('HDN-', UPPER(RIGHT("id", 8)))
WHERE "orderCode" IS NULL OR "orderCode" = '';

UPDATE "orders"
SET "orderState" = CASE
  WHEN COALESCE("paidAmount", 0) <= 0 THEN 'DRAFT'::"OrderLifecycleState"
  WHEN COALESCE("paidAmount", 0) >= COALESCE("finalAmount", 0) THEN 'PAID'::"OrderLifecycleState"
  ELSE 'PARTIAL'::"OrderLifecycleState"
END
WHERE "orderState" IS NULL OR "orderState"::text = '';

UPDATE "orders" SET "surchargeAmount" = 0 WHERE "surchargeAmount" IS NULL;
UPDATE "order_items" SET "baseUnitPrice" = "unitPrice" WHERE "baseUnitPrice" IS NULL;
