UPDATE "order_items" oi
SET "timerState" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "order_item_time_sessions" ts
    WHERE ts."orderItemId" = oi.id
      AND ts."endedAt" IS NULL
  ) THEN 'ON'::"TimerState"
  ELSE 'OFF'::"TimerState"
END;

CREATE UNIQUE INDEX IF NOT EXISTS "order_item_time_sessions_one_open_per_item_idx"
ON "order_item_time_sessions"("orderItemId")
WHERE "endedAt" IS NULL;
