-- Add product inventory/soft-delete columns used by runtime queries
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "unit" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight" DECIMAL(12,3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock" DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Product availability per branch
CREATE TABLE IF NOT EXISTS "product_branches" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_branches_productId_branchId_key"
ON "product_branches"("productId", "branchId");

CREATE INDEX IF NOT EXISTS "product_branches_productId_idx"
ON "product_branches"("productId");

CREATE INDEX IF NOT EXISTS "product_branches_branchId_idx"
ON "product_branches"("branchId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_branches_productId_fkey'
  ) THEN
    ALTER TABLE "product_branches"
      ADD CONSTRAINT "product_branches_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_branches_branchId_fkey'
  ) THEN
    ALTER TABLE "product_branches"
      ADD CONSTRAINT "product_branches_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
