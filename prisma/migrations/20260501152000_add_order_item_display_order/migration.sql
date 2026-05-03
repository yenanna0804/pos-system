ALTER TABLE "order_items"
ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "orderId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "order_items"
)
UPDATE "order_items" oi
SET "displayOrder" = ranked.rn
FROM ranked
WHERE oi.id = ranked.id;

ALTER TABLE "order_items"
ALTER COLUMN "displayOrder" SET NOT NULL;

ALTER TABLE "order_items"
ALTER COLUMN "displayOrder" SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS "order_items_orderId_displayOrder_idx"
ON "order_items" ("orderId", "displayOrder");
