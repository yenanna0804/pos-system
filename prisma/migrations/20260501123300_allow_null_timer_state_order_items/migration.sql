ALTER TABLE "order_items"
  ALTER COLUMN "timerState" DROP NOT NULL;

ALTER TABLE "order_items"
  ALTER COLUMN "timerState" DROP DEFAULT;
