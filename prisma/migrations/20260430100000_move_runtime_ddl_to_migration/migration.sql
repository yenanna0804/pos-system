-- Move runtime schema bootstrap from seed.ts into migrations

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "imageThumb" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "type" TEXT DEFAULT 'SINGLE';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "autoPrice" BOOLEAN DEFAULT true;

ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "areaId" TEXT;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "roomId" TEXT;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

DROP TABLE IF EXISTS "order_draft_logs";
DROP TABLE IF EXISTS "order_drafts";

CREATE TABLE IF NOT EXISTS "areas" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "branchId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "rooms" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "areaId" TEXT NOT NULL,
  "branchId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'areas_branchId_fkey'
  ) THEN
    ALTER TABLE "areas"
      ADD CONSTRAINT "areas_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rooms_areaId_fkey'
  ) THEN
    ALTER TABLE "rooms"
      ADD CONSTRAINT "rooms_areaId_fkey"
      FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rooms_branchId_fkey'
  ) THEN
    ALTER TABLE "rooms"
      ADD CONSTRAINT "rooms_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tables_areaId_fkey'
  ) THEN
    ALTER TABLE "tables"
      ADD CONSTRAINT "tables_areaId_fkey"
      FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tables_roomId_fkey'
  ) THEN
    ALTER TABLE "tables"
      ADD CONSTRAINT "tables_roomId_fkey"
      FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "product_combo_items" (
  "id" TEXT NOT NULL,
  "comboProductId" TEXT NOT NULL,
  "itemProductId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_combo_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_combo_items_comboProductId_itemProductId_key"
ON "product_combo_items"("comboProductId", "itemProductId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_combo_items_comboProductId_fkey'
  ) THEN
    ALTER TABLE "product_combo_items"
      ADD CONSTRAINT "product_combo_items_comboProductId_fkey"
      FOREIGN KEY ("comboProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_combo_items_itemProductId_fkey'
  ) THEN
    ALTER TABLE "product_combo_items"
      ADD CONSTRAINT "product_combo_items_itemProductId_fkey"
      FOREIGN KEY ("itemProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
