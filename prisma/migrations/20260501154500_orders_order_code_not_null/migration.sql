UPDATE "orders"
SET "orderCode" = CONCAT('HD-', id)
WHERE "orderCode" IS NULL;

ALTER TABLE "orders"
ALTER COLUMN "orderCode" SET NOT NULL;
