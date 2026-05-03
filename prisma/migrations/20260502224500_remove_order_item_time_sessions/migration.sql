DROP TABLE IF EXISTS "order_item_time_sessions" CASCADE;

ALTER TABLE "order_items"
  DROP COLUMN IF EXISTS "timerState";

DROP TYPE IF EXISTS "TimerState";
