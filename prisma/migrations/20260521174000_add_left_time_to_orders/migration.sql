ALTER TABLE orders
ADD COLUMN IF NOT EXISTS "leftTime" timestamptz(3);
