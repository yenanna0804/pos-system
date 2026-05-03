-- Rebuild orders module schema from scratch.
-- NOTE: This migration is destructive for order data.

DROP TABLE IF EXISTS "order_item_time_sessions" CASCADE;
DROP TABLE IF EXISTS "order_logs" CASCADE;
DROP TABLE IF EXISTS "order_items" CASCADE;
DROP TABLE IF EXISTS "orders" CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderAdjustmentMode') THEN
    CREATE TYPE "OrderAdjustmentMode" AS ENUM ('percent', 'amount');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLifecycleState') THEN
    CREATE TYPE "OrderLifecycleState" AS ENUM ('PARTIAL', 'PAID', 'DELETED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethod') THEN
    CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANKING');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PricingTypeSnapshot') THEN
    CREATE TYPE "PricingTypeSnapshot" AS ENUM ('FIXED', 'TIME');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TimerState') THEN
    CREATE TYPE "TimerState" AS ENUM ('OFF', 'ON');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLogAction') THEN
    CREATE TYPE "OrderLogAction" AS ENUM ('CREATE_ORDER', 'UPDATE_ORDER', 'DELETE_ORDER', 'PAY_PARTIAL', 'PAY_FULL', 'PRINT_ORDER');
  END IF;
END $$;

CREATE TABLE "orders" (
  "id" TEXT NOT NULL,
  "orderCode" TEXT NOT NULL,
  "tableId" TEXT,
  "roomId" TEXT,
  "branchId" TEXT,
  "userId" TEXT NOT NULL,
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discountMode" "OrderAdjustmentMode" NOT NULL DEFAULT 'amount',
  "discountValue" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "surchargeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "surchargeMode" "OrderAdjustmentMode" NOT NULL DEFAULT 'amount',
  "surchargeValue" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "finalAmount" DECIMAL(12,2) NOT NULL,
  "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "customerName" TEXT,
  "orderState" "OrderLifecycleState" NOT NULL DEFAULT 'PARTIAL',
  "paymentMethod" "PaymentMethod",
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_orderCode_key" ON "orders"("orderCode");

CREATE TABLE "order_items" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "pricingTypeSnapshot" "PricingTypeSnapshot" NOT NULL DEFAULT 'FIXED',
  "baseUnitPrice" DECIMAL(14,2),
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "totalPrice" DECIMAL(12,2) NOT NULL,
  "timeRateAmountSnapshot" DECIMAL(14,2),
  "timeRateMinutesSnapshot" INTEGER,
  "timerState" "TimerState",
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_items_orderId_displayOrder_idx" ON "order_items"("orderId", "displayOrder");

CREATE TABLE "order_item_time_sessions" (
  "id" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "durationMinutes" INTEGER,
  "startedBy" TEXT NOT NULL,
  "endedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_item_time_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_item_time_sessions_orderItemId_endedAt_idx" ON "order_item_time_sessions"("orderItemId", "endedAt");
CREATE UNIQUE INDEX "order_item_time_sessions_one_open_per_item_idx" ON "order_item_time_sessions"("orderItemId") WHERE "endedAt" IS NULL;

CREATE TABLE "order_logs" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "action" "OrderLogAction" NOT NULL,
  "detail" TEXT,
  "snapshot" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_logs_orderId_createdAt_idx" ON "order_logs"("orderId", "createdAt");

ALTER TABLE "orders" ADD CONSTRAINT "orders_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_item_time_sessions" ADD CONSTRAINT "order_item_time_sessions_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_logs" ADD CONSTRAINT "order_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_logs" ADD CONSTRAINT "order_logs_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
