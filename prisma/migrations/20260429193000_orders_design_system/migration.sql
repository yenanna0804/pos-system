-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLifecycleState') THEN
    CREATE TYPE "OrderLifecycleState" AS ENUM ('DRAFT', 'PARTIAL', 'PAID', 'DELETED');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLogAction') THEN
    CREATE TYPE "OrderLogAction" AS ENUM ('CREATE_DRAFT', 'UPDATE_ORDER', 'PRINT_ORDER', 'DELETE_ORDER', 'PAY_PARTIAL', 'PAY_FULL');
  END IF;
END $$;

-- Orders additive columns
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "orderCode" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "orderState" "OrderLifecycleState" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billItems" JSONB;

-- Backfill order code and state
UPDATE "orders"
SET "orderCode" = CONCAT('HDN-', UPPER(RIGHT("id", 8)))
WHERE "orderCode" IS NULL OR "orderCode" = '';

UPDATE "orders"
SET "orderState" = CASE
  WHEN "status" = CAST('CANCELLED' AS "OrderStatus") THEN CAST('DELETED' AS "OrderLifecycleState")
  WHEN "paymentStatus" = CAST('UNPAID' AS "PaymentStatus") THEN CAST('DRAFT' AS "OrderLifecycleState")
  WHEN "paymentStatus" = CAST('PAID' AS "PaymentStatus") THEN CAST('PAID' AS "OrderLifecycleState")
  ELSE CAST('PARTIAL' AS "OrderLifecycleState")
END;

-- Safe unique index for order code
CREATE UNIQUE INDEX IF NOT EXISTS "orders_orderCode_key" ON "orders"("orderCode");

-- Action logs table
CREATE TABLE IF NOT EXISTS "order_logs" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "action" "OrderLogAction" NOT NULL,
  "detail" TEXT,
  "snapshot" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_logs_pkey" PRIMARY KEY ("id")
);

-- Foreign keys and indexes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_logs_orderId_fkey') THEN
    ALTER TABLE "order_logs"
      ADD CONSTRAINT "order_logs_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_logs_createdBy_fkey') THEN
    ALTER TABLE "order_logs"
      ADD CONSTRAINT "order_logs_createdBy_fkey"
      FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "order_logs_orderId_createdAt_idx" ON "order_logs"("orderId", "createdAt");

-- Normalize old draft state (if any rows were soft-deleted before)
UPDATE "orders"
SET "orderState" = CAST('DELETED' AS "OrderLifecycleState")
WHERE "status" = CAST('CANCELLED' AS "OrderStatus");
