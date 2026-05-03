DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TimerState') THEN
    CREATE TYPE "TimerState" AS ENUM ('OFF', 'ON');
  END IF;
END $$;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "timerState" "TimerState" NOT NULL DEFAULT 'OFF';
