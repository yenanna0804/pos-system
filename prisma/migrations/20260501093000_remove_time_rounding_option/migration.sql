ALTER TABLE "products" DROP COLUMN IF EXISTS "timeRoundingMode";
ALTER TABLE "products" DROP COLUMN IF EXISTS "timeStepMinutes";

ALTER TABLE "order_items" DROP COLUMN IF EXISTS "timeRoundingModeSnapshot";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "timeStepMinutesSnapshot";
