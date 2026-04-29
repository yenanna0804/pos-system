-- Backfill orderState from legacy status/paymentStatus before dropping columns
UPDATE "orders"
SET "orderState" = CASE
  WHEN "status" = CAST('CANCELLED' AS "OrderStatus") THEN CAST('DELETED' AS "OrderLifecycleState")
  WHEN "paymentStatus" = CAST('UNPAID' AS "PaymentStatus") THEN CAST('DRAFT' AS "OrderLifecycleState")
  WHEN "paymentStatus" = CAST('PAID' AS "PaymentStatus") THEN CAST('PAID' AS "OrderLifecycleState")
  ELSE CAST('PARTIAL' AS "OrderLifecycleState")
END
WHERE "orderState" IS NULL OR "orderState"::text = '';

ALTER TABLE "orders" DROP COLUMN IF EXISTS "status";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "paymentStatus";

DROP TYPE IF EXISTS "OrderStatus";
DROP TYPE IF EXISTS "PaymentStatus";
