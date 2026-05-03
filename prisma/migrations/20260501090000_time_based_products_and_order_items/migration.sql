ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "timeRateAmount" DECIMAL(14,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "timeRateMinutes" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "timeRoundingMode" TEXT DEFAULT 'NONE';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "timeStepMinutes" INTEGER;

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "pricingTypeSnapshot" TEXT DEFAULT 'FIXED';
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "timeRateAmountSnapshot" DECIMAL(14,2);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "timeRateMinutesSnapshot" INTEGER;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "timeRoundingModeSnapshot" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "timeStepMinutesSnapshot" INTEGER;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "usedMinutes" INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS "order_item_time_sessions" (
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_item_time_sessions_orderItemId_fkey'
  ) THEN
    ALTER TABLE "order_item_time_sessions"
      ADD CONSTRAINT "order_item_time_sessions_orderItemId_fkey"
      FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "order_item_time_sessions_orderItemId_endedAt_idx"
ON "order_item_time_sessions"("orderItemId", "endedAt");
