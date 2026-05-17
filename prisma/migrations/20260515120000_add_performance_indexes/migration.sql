-- Performance indexes for Prisma-managed tables
CREATE INDEX IF NOT EXISTS "users_branchId_idx" ON "users"("branchId");
CREATE INDEX IF NOT EXISTS "products_categoryId_idx" ON "products"("categoryId");
CREATE INDEX IF NOT EXISTS "tables_branchId_idx" ON "tables"("branchId");
CREATE INDEX IF NOT EXISTS "orders_branchId_orderState_idx" ON "orders"("branchId", "orderState");
CREATE INDEX IF NOT EXISTS "orders_branchId_createdAt_idx" ON "orders"("branchId", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_tableId_idx" ON "orders"("tableId");
CREATE INDEX IF NOT EXISTS "orders_roomId_idx" ON "orders"("roomId");
CREATE INDEX IF NOT EXISTS "orders_userId_idx" ON "orders"("userId");
CREATE INDEX IF NOT EXISTS "order_items_productId_idx" ON "order_items"("productId");

-- Performance indexes for non-Prisma tables (areas, rooms, tables extra cols)
CREATE INDEX IF NOT EXISTS "areas_branchId_idx" ON "areas"("branchId");
CREATE INDEX IF NOT EXISTS "rooms_areaId_idx" ON "rooms"("areaId");
CREATE INDEX IF NOT EXISTS "rooms_branchId_idx" ON "rooms"("branchId");
CREATE INDEX IF NOT EXISTS "tables_areaId_idx" ON "tables"("areaId");
CREATE INDEX IF NOT EXISTS "tables_roomId_idx" ON "tables"("roomId");

-- Performance index for product_combo_items lookup by itemProductId
CREATE INDEX IF NOT EXISTS "product_combo_items_itemProductId_idx" ON "product_combo_items"("itemProductId");
